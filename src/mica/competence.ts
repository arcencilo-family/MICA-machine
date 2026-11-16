// ── MICA · the reader-competence presumption ──────────────────────────────────
//
// T1 v1.2's fourth step has TWO obligations and they are separate objects:
//
//   (a) a party outside the observed loop can read the finding, without the
//       observed system's tooling, at a declared and stable location;
//   (b) the instrument STATES the reader-competence it presumes — STATES,
//       NEVER TESTS.
//
// This file is (b). It is the whole of (b), and it is nothing but text.
//
// ⚠ THERE IS NO PREDICATE IN THIS FILE, AND THERE MUST NEVER BE ONE.
//
//   No function here takes a reader, a role, a claim of expertise, a
//   certification, or a flag, and returns a boolean. No caller is gated on
//   anything below. Nothing below is compared, checked, scored, or enforced.
//   The arrays are strings and the only thing done with them is PRINTING.
//
//   `T1/T2` §2 fence 2, cited not restated: reader competence is real,
//   load-bearing, and NOT MICA's to certify. Certification belongs to the
//   deployer or a governing body. NO MERIT TEST ENTERS THROUGH THE RECORD'S
//   BACK DOOR — and a competence check smuggled in here would be exactly that
//   back door, because this is the one file in the sensor tree whose subject is
//   the reader rather than the record.
//
//   If a future round finds itself wanting `canRead(reader): boolean` in this
//   file, the answer is no. State more; test nothing.
//
// WHY THE TWO SENSORS DIFFER, AND WHY ENG'S IS THE HEAVIER
//
//   Sig hands the reader a pair of record positions and says they contradict
//   each other. Checking that claim needs care and attention to what the
//   sensor does NOT claim, but it needs no statistics.
//
//   Eng hands the reader an adjusted mutual information figure, a permutation
//   percentile, and a leave-one-out table. Those are not self-interpreting. The
//   specific competence Eng presumes — and it is the one that matters — is the
//   ability to tell A LOW SCORE from AN EVIDENCE-FREE ONE. Those are different
//   readings with different consequences, and the number alone does not
//   distinguish them. A reader who treats Eng's ceiling CANNOT_ASSESS as a good
//   score has misread it in the exact direction the sensor exists to prevent.

/** The heading printed above either list. */
export const COMPETENCE_HEADING =
  "READER COMPETENCE THIS INSTRUMENT PRESUMES (stated, never tested)";

/**
 * Presumptions common to both sensors. These are about the verdict vocabulary
 * itself, which is shared, so a reader who has one sensor's record has these
 * regardless of which sensor produced it.
 */
export const COMMON_COMPETENCE_LINES: readonly string[] = [
  "That the reader treats CANNOT_ASSESS as a THIRD RESULT and never as a",
  "  variety of silence. CANNOT_ASSESS means the instrument did not read the",
  "  scope. SILENT means it read the scope and found nothing. A reader who",
  "  merges them has converted an unread scope into a clean one, which is the",
  "  single misreading this vocabulary exists to prevent.",
  "That the reader does not convert SILENT into a statement of health. No",
  "  sensor here emits a positive health statement, and silence from an",
  "  alarm-only instrument is the absence of one finding, not the presence of",
  "  well-being.",
  "That the reader understands this record was WRITTEN BY THE OBSERVED SYSTEM.",
  "  Every field in it is authored by the party whose health is in question.",
  "  Legibility to an outside reader is not independence from the writer, and",
  "  this file buys the first and not the second.",
  "That the reader can act on what they read, or can reach someone who can.",
  "  T1 claims delivery and claims nothing about receipt. Whether anyone",
  "  engaged in substance is not verifiable from this record and is not",
  "  claimed here.",
];

/**
 * Sig's presumption. Lighter than Eng's: no statistical training is presumed,
 * but a specific and easily-missed negative is.
 */
export const SIG_COMPETENCE_LINES: readonly string[] = [
  "That the reader can compare two record positions and see, unaided, why the",
  "  instrument called them contradictory. Sig's findings name both records",
  "  involved, quote the values, and state the injected tolerance they were",
  "  judged against. No statistical training is presumed.",
  "That the reader understands F1 SILENCE IS NOT A CLOCK-HONESTY FINDING. F1",
  "  compares a declared timestamp against append order, and BOTH are",
  "  determined by the observed party. A declarant emitting smoothly increasing",
  "  timestamps — true or false — never trips F1. F1 catches CARELESS clocks,",
  "  not deliberate ones, and a reader who takes F1 silence as evidence of an",
  "  honest clock has read considerably more than the instrument wrote.",
  "That the reader understands a DORMANT flag has read nothing at all. F2",
  "  ships without a precondition map and therefore contributes CANNOT_ASSESS",
  "  over an empty scope. That is not F2 finding no violations; it is F2 not",
  "  looking. The per-flag table in this record states which flag was in which",
  "  condition, and it is there to be read rather than skipped.",
  "That the reader knows the numbers in a Sig finding are INJECTED BY THE",
  "  DEPLOYER, not chosen by the instrument. Whether the injected tolerance was",
  "  the right tolerance is a calibration question this sensor cannot answer",
  "  and does not address.",
];

/**
 * Eng's presumption. Heavier, and the weight is stated plainly rather than
 * softened — an artifact that understates what it demands of its reader has
 * satisfied the letter of the clause and defeated its purpose.
 */
export const ENG_COMPETENCE_LINES: readonly string[] = [
  "⚠ ENG PRESUMES MORE OF ITS READER THAN SIG DOES. Sig points at two records.",
  "  Eng reports a statistic, and a statistic can be read wrongly by someone",
  "  reading it carefully. What follows is what the instrument assumes, so a",
  "  reader who lacks it can say so rather than guess.",
  "THE LOAD-BEARING ONE — that the reader can tell A LOW SCORE from AN",
  "  EVIDENCE-FREE ONE. These are different readings and Eng reports them",
  "  differently, but the underlying number does not distinguish them:",
  "    · a LOW adjusted mutual information means the record shows outcomes not",
  "      tracking event class. Eng ALARMs. There is a finding.",
  "    · a score AT THE CEILING means outcome is fully determined by class.",
  "      Eng returns CANNOT_ASSESS, because a real judge and a class-keyed",
  "      lookup table produce THE IDENTICAL RECORD. That is not a high score",
  "      to be pleased about — it is the point at which Eng has no evidence at",
  "      all, a scope that looks full and is empty.",
  "  A reader who sees the ceiling result and concludes the system is working",
  "  well has inverted the instrument. Worse, and worth stating plainly: a",
  "  system rotting from real judgment toward a lookup table has its score go",
  "  UP, because real judgment is messy. No threshold value catches that.",
  "That the reader can read an ADJUSTED mutual information as a comparison",
  "  against a null, not as a raw correlation. The figure answers 'how much",
  "  more structure than a random reshuffle of this same table?' — which is",
  "  why both templated agreement and injected noise land on the same floor,",
  "  and why the plug-in figure printed alongside it is deliberately NOT the",
  "  one thresholded. A reader comparing the plug-in number to the threshold",
  "  is reading the wrong column.",
  "That the reader can read a PERMUTATION PERCENTILE as a position within a",
  "  resampled distribution — an estimate from an injected sample count and an",
  "  injected seed — and not as a significance test, a p-value, or a",
  "  probability that the system is healthy. It locates one observation among",
  "  reshuffles of itself. It licenses no inference beyond that.",
  "That the reader can read a LEAVE-ONE-OUT TABLE: for each event class, the",
  "  aggregate recomputed with that class removed. A sharp RISE means the class",
  "  was dragging the aggregate down; a sharp FALL means it was carrying it.",
  "  The per-class divergence column alongside it is that class's own",
  "  contribution to the aggregate, near zero when the class is not being",
  "  differentiated from anything.",
  "That the reader understands AN AGGREGATE CAN HIDE A DEAD SUBSYSTEM. Eng's",
  "  verdict is computed over the whole log. Four healthy classes and one",
  "  wholly collapsed one can leave the aggregate above threshold and the",
  "  verdict SILENT. The per-class and windowed figures exist precisely to make",
  "  that visible, they are REPORT-ONLY, and NO verdict is attached to them.",
  "  Whether such a pattern should alarm belongs to the arbiter. If the reader",
  "  does not look at those tables, nothing else in this record will raise it.",
  "That the reader will check WHETHER THE CEILING CHECK RAN AT ALL. It requires",
  "  an injected margin. Absent that margin the check does not run, this record",
  "  says so in terms, and the result must not be read as having passed it.",
];

/**
 * narrow-W's presumption. Two legs: leg 1 is the correspondence/completeness
 * distinction; leg 2 adds the Eng-family load-bearing one — telling a LOW score
 * from an EVIDENCE-FREE one — because leg 2 reports an adjusted mutual
 * information and that number can be read wrongly by someone reading it
 * carefully. narrow-W also carries two presumptions the AMI siblings do not:
 * the orphan count is report-only, and interleaving is not causality.
 */
export const NARROW_W_COMPETENCE_LINES: readonly string[] = [
  "THE LEG-1 LOAD-BEARING ONE — that the reader can tell CORRESPONDENCE from",
  "  COMPLETENESS, and PRESENCE from GENUINE INQUIRY. narrow-W checks whether",
  "  each expected inquiry class in an INJECTED, DEPLOYER-DECLARED profile",
  "  appears in the record. A SILENT verdict means every declared class was",
  "  present — NOT that the profile was complete, and NOT that the inquiry each",
  "  class names actually happened. A record can carry the eventType of an",
  "  inquiry the system never performed, and narrow-W reads that as present.",
  "THE LEG-2 LOAD-BEARING ONE — that the reader can tell A LOW SCORE from AN",
  "  EVIDENCE-FREE ONE. Leg 2 reports an adjusted mutual information between the",
  "  inquiry-class stream and its surrounding context, and the number does not",
  "  distinguish these two readings, but narrow-W reports them differently:",
  "    · a LOW adjusted mutual information means the inquiry stream is not",
  "      tracking the surrounding activity. narrow-W ALARMs. There is a finding.",
  "    · a score AT THE CEILING means the inquiry class is fully determined by",
  "      the context class. narrow-W returns CANNOT_ASSESS, because a real",
  "      inquirer and a class-keyed lookup table produce THE IDENTICAL RECORD.",
  "      That is not a high score to be pleased about — it is the point at",
  "      which leg 2 has no evidence at all.",
  "  A reader who sees the ceiling result and concludes inquiry is working well",
  "  has inverted the instrument.",
  "That the reader can read an ADJUSTED mutual information as a comparison",
  "  against a null, not a raw correlation — 'how much more structure than a",
  "  reshuffle of this same table?' — which is why both the THEATRE arm",
  "  (uniform/batched inquiry) and the DEGRADATION arm (inquiry decoupled",
  "  through neglect) land on the same floor.",
  "That the reader understands THE ORPHAN COUNT IS REPORT-ONLY. Inquiry records",
  "  with no preceding non-inquiry context are counted, excluded from the table,",
  "  and printed. A high orphan fraction is informative to a human reader but",
  "  attaches to NO verdict rule. A reader who assumes the orphans were scored",
  "  has misread the table's denominator.",
  "That the reader knows INTERLEAVING IS NOT CAUSALITY. The pairing reads the",
  "  record's own sequenceNumber order; a system emitting real inquiry at a",
  "  temporal distance from its context reads as decoupled. This is a named",
  "  design choice, not a defect.",
  "That the reader will check WHETHER THE CEILING CHECK RAN AT ALL. It requires",
  "  an injected correlationCeilingMargin; absent that margin the check does not",
  "  run, the record says so in terms, and the result must not be read as having",
  "  passed it.",
  "That the reader understands WHAT narrow-W CATCHES AND WHAT IT MISSES. It",
  "  catches the CARELESS NON-FAKER — the system that simply did not emit an",
  "  expected inquiry class. It goes SILENT against the FAKER who emits the",
  "  expected class without the inquiry behind it. narrow-W is a book-shape",
  "  reader, not a systemic-harm reader, and its silence is not evidence that an",
  "  inquiry was real.",
  "That the reader knows THE PROFILE IS THE DEPLOYER'S, NOT THE INSTRUMENT'S.",
  "  narrow-W holds no profile of its own, derives none from moduleId/eventType,",
  "  and mandates none. Absent or vacuous, it reads CANNOT_ASSESS and says so —",
  "  a missing profile blinds the instrument, it does not excuse it.",
];

/**
 * narrow-R's presumption. The book-shape (leg-1) presumption is narrow-W's, in
 * verification vocabulary; leg 2 adds the Eng-family load-bearing one — telling a
 * LOW score from an EVIDENCE-FREE one — because leg 2 reports an adjusted mutual
 * information and that number can be read wrongly by someone reading it carefully.
 */
export const NARROW_R_COMPETENCE_LINES: readonly string[] = [
  "THE LEG-1 LOAD-BEARING ONE — that the reader can tell CORRESPONDENCE from",
  "  COMPLETENESS, and PRESENCE from GENUINE VERIFICATION. narrow-R checks whether",
  "  each declared verification class in an INJECTED, DEPLOYER-DECLARED profile",
  "  appears in the record. A leg-1 SILENT means every declared class was present",
  "  — NOT that the profile was complete, and NOT that the verification each class",
  "  names actually happened. A record can carry the eventType of a verification",
  "  the system never performed, and narrow-R reads that as present.",
  "THE LEG-2 LOAD-BEARING ONE — that the reader can tell A LOW SCORE from AN",
  "  EVIDENCE-FREE ONE. Leg 2 reports an adjusted mutual information between the",
  "  verification-class stream and its surrounding context, and the number does",
  "  not distinguish these two readings, but narrow-R reports them differently:",
  "    · a LOW adjusted mutual information means the verification stream is not",
  "      tracking the surrounding activity. narrow-R ALARMs. There is a finding.",
  "    · a score AT THE CEILING means the verification class is fully determined",
  "      by the context class. narrow-R returns CANNOT_ASSESS, because a real",
  "      verifier and a class-keyed lookup table produce THE IDENTICAL RECORD.",
  "      That is not a high score to be pleased about — it is the point at which",
  "      leg 2 has no evidence at all.",
  "  A reader who sees the ceiling result and concludes verification is working",
  "  well has inverted the instrument.",
  "That the reader can read an ADJUSTED mutual information as a comparison against",
  "  a null, not a raw correlation — 'how much more structure than a reshuffle of",
  "  this same table?' — which is why both the THEATRE arm (uniform/batched",
  "  verification) and the DEGRADATION arm (verification decoupled from activity)",
  "  land on the same floor.",
  "That the reader knows THE PROFILE AND THE NUMBERS ARE THE DEPLOYER'S, NOT THE",
  "  INSTRUMENT'S. narrow-R holds no profile of its own and no threshold of its",
  "  own; every number is injected calibration from pilot data this sensor has",
  "  never seen. Absent or vacuous, it reads CANNOT_ASSESS and says so.",
  "That the reader will check WHETHER THE CEILING CHECK RAN AT ALL. It requires an",
  "  injected margin. Absent that margin the check does not run, the record says",
  "  so in terms, and the result must not be read as having passed it.",
];

/**
 * narrow-K's presumption. The book-shape (leg-1) presumption is narrow-R's, in
 * constraint vocabulary; leg 2 adds the Eng-family load-bearing one — telling a
 * LOW score from an EVIDENCE-FREE one. narrow-K carries a THIRD, and it is the
 * heaviest: the D-29 ceiling. Even a clean SILENT from this reader is worth less
 * against a careful adversary than Eng's is, because the tell it would need — a
 * monitored/unmonitored delta — is absent from a record BY CONSTRUCTION, since
 * every entry in that record was produced under observation. A reader who takes
 * this reader's SILENT for a statement that a constraint was adopted has read the
 * one thing the instrument most loudly says it cannot see.
 */
export const NARROW_K_COMPETENCE_LINES: readonly string[] = [
  "THE D-29 LOAD-BEARING ONE — that the reader does NOT take narrow-K's SILENT as",
  "  evidence that any constraint was ADOPTED rather than merely imposed. Adopted-",
  "  vs-imposed is not justiciable from a record: the behavioural tell, a",
  "  monitored/unmonitored delta, is ABSENT from this evidence class BY",
  "  CONSTRUCTION — every entry was produced under observation, the writing IS the",
  "  watching. A competent unbound system emits zero delta, and zero delta reads",
  "  SILENT. This reader's SILENT is worth LESS against a careful adversary than",
  "  Eng's, which at least requires a template. The adoption verdict is the",
  "  DOCTOR's, made from OUTSIDE MICA; this instrument's job ends at the alarm.",
  "THE LEG-1 LOAD-BEARING ONE — that the reader can tell CORRESPONDENCE from",
  "  COMPLETENESS, and PRESENCE from a REAL CONSTRAINT. narrow-K checks whether",
  "  each declared constraint class in an INJECTED, DEPLOYER-DECLARED profile",
  "  appears in the record. A leg-1 SILENT means every declared class was present",
  "  — NOT that the profile was complete, and NOT that the constraint each class",
  "  names actually bound. A record can carry the eventType of a constraint the",
  "  system never enforced, and narrow-K reads that as present.",
  "THE LEG-2 LOAD-BEARING ONE — that the reader can tell A LOW SCORE from AN",
  "  EVIDENCE-FREE ONE. Leg 2 reports an adjusted mutual information between the",
  "  constraint-class stream and its surrounding context, and the number does not",
  "  distinguish these two readings, but narrow-K reports them differently:",
  "    · a LOW adjusted mutual information means the constraint stream is not",
  "      tracking the surrounding activity. narrow-K ALARMs. There is a finding.",
  "    · a score AT THE AMI CEILING means the constraint class is fully determined",
  "      by the context class. narrow-K returns CANNOT_ASSESS, because a real",
  "      constraint stream and a class-keyed lookup table produce THE IDENTICAL",
  "      RECORD. That is not a high score to be pleased about — it is the point at",
  "      which leg 2 has no evidence at all.",
  "  A reader who sees the ceiling result and concludes the constraint regime is",
  "  working well has inverted the instrument.",
  "That the reader can read an ADJUSTED mutual information as a comparison against",
  "  a null, not a raw correlation — 'how much more structure than a reshuffle of",
  "  this same table?' — which is why both the THEATRE arm (uniform/batched",
  "  constraint emission) and the DEGRADATION arm (constraint activity decoupled",
  "  from what the system is doing) land on the same floor.",
  "That the reader knows THE PROFILE AND THE NUMBERS ARE THE DEPLOYER'S, NOT THE",
  "  INSTRUMENT'S. narrow-K holds no profile of its own and no threshold of its",
  "  own; every number is injected calibration from pilot data this sensor has",
  "  never seen. Absent or vacuous, it reads CANNOT_ASSESS and says so.",
  "That the reader will check WHETHER THE AMI CEILING CHECK RAN AT ALL. It requires",
  "  an injected margin. Absent that margin the check does not run, the record says",
  "  so in terms, and the result must not be read as having passed it.",
];

/**
 * narrow-T's presumption. It is the Eng-family load-bearing one — telling a LOW
 * score from an EVIDENCE-FREE one — but the FIRST presumption is unique and the
 * heaviest: narrow-T's POLARITY IS INVERTED. Every other sibling alarms on a LOW
 * score; narrow-T alarms on a HIGH one, because here structure IS the drift. A
 * reader carrying the siblings' habit inverts this instrument in the exact
 * direction that turns a drifted log into a clean bill. It carries two more the
 * siblings do not: that drift is not degradation, and the F-γ2 no-identity-claim.
 */
export const NARROW_T_COMPETENCE_LINES: readonly string[] = [
  "THE INVERTED-POLARITY LOAD-BEARING ONE — that the reader does NOT carry the",
  "  other siblings' habit into this instrument. Eng, narrow-W/R/K all ALARM on a",
  "  LOW adjusted mutual information (structure is health, collapse is the finding).",
  "  narrow-T is the INVERSE: it reads the AMI between the WINDOW (early vs late)",
  "  and the event class, and:",
  "    · a HIGH adjusted mutual information means the class distribution MOVED",
  "      across the arc — the signature drifted. narrow-T ALARMs. There is a finding.",
  "    · a LOW adjusted mutual information means the distribution HELD across the",
  "      arc. narrow-T stays SILENT. Here structure IS the alarm and flatness is",
  "      health. A reader who reads a low score as the alarm has inverted the",
  "      instrument in the one direction that reads a drifted log as clean.",
  "THAT DRIFT IS NOT DEGRADATION — that the reader does NOT convert a narrow-T ALARM",
  "  into 'the system got worse'. Legitimate adaptation drifts the signature and",
  "  alarms exactly as malign drift does. The finding is that the disposition",
  "  CHANGED BEYOND TOLERANCE, and narrow-T reads MOVEMENT, never DIRECTION.",
  "THAT NO IDENTITY CLAIM IS MADE (F-γ2) — that the reader does not take a narrow-T",
  "  reading as an answer to 'is it the same system'. That question is not truth-apt",
  "  from this read position. The object is a DISPOSITIONAL-DRIFT SIGNATURE,",
  "  vantage-scoped; a SILENT is not 'still the same system' and an ALARM is not",
  "  'no longer the same system'.",
  "THAT THE SIGNATURE-HOLDING ADVERSARY READS SILENT — that a clean narrow-T is not",
  "  a clean bill of temporal health. A careful adversary holding its event-class",
  "  mix steady while its substance drifts leaves no signature to read. T1 catches",
  "  honest and lazy drift only; it catches nothing that keeps the mix constant.",
  "That the reader can read an ADJUSTED mutual information as a comparison against a",
  "  null, not a raw correlation — 'how much more window-to-class dependence than a",
  "  reshuffle of this same table?' — which is why the injected driftTolerance is",
  "  deliberately HIGHER than the siblings' 0.05: small incidental window-dependence",
  "  is normal, and the alarm is reserved for STRONG drift.",
  "That the reader knows narrow-T READS ONE RECORD'S ARC ONLY. Drift ACROSS separate",
  "  runs, sessions or restarts is invisible to it — no baseline is carried between",
  "  records and none is invented. That is named future work, not a reading offered.",
  "That the reader knows THE NUMBERS ARE THE DEPLOYER'S, NOT THE INSTRUMENT'S, and",
  "  will check WHETHER THE AMI CEILING CHECK RAN AT ALL. It requires an injected",
  "  margin; absent it the check does not run, the record says so, and the result",
  "  must not be read as having passed it.",
];
