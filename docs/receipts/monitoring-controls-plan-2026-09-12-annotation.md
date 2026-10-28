# Annotation — monitoring-controls-plan-2026-09-12.json

Date of note: 2026-09-16. The JSON receipt is an immutable historical artifact;
this sibling note records a later audit finding without editing it.

## Finding (hardening cartography, contradiction register #10)

A wave-1 audit relation described this receipt as covering "18 `apps/web/src`
files" (`hardening/contradictions.md` #10). The receipt's `sourceSha256`
manifest lists exactly **17** `apps/web/src` entries (52 hashed files total).
The receipt JSON itself states no file count; the "18" figure originated in the
audit's own relation label (a hash-pin spot-check recorded as "10 MATCH / 8
STALE"), not in the receipt. The adversarial re-verification refuted the edge's
cardinality ("edge real, cardinality wrong", wave-2 verdict R-78).

## What remains true

- 17 `apps/web/src` hashes + 35 other source hashes = 52 total; the execution
  manifest's "All 52 relevant pre-run source hashes were unchanged" is
  consistent with the manifest.
- All gate counters (`providerGatesPassed: 0`, `operationGatesPassed: 0`),
  command results and limits in the receipt are unaffected by this finding.

## Open question

`hardening/open_questions.md` #1 (receipt integrity policy: immutable-annotate
vs living-fix) stays open for the repo owners. This note follows the
immutable-annotate reading; no receipt JSON was modified.
