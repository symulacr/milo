# DEAD-CODE-REPORT.md

Three-signal rule (S1 static, S2 tests, S3 runtime). No removals yet — baseline only.

| item | S1 | S2 | S3 | verdict |
|---|---|---|---|---|
| p0-dust.mjs | unused | no tests | no runtime | removed earlier |
| convex/_generated | generated | n/a | n/a | untracked |
| d2c-split | unused | no | no | removed earlier |

## DC1 pass 2026-10-01 (three-signal)

| item | S1 knip | S2 tests | S3 runtime | verdict |
|---|---|---|---|---|
| apps/web/** components | listed unused (entry-graph false +) | exercised by web tests | via app routes | KEEP-WITH-REASON: knip lacks React entry graph |
| qa-drive*.mjs | unused | no | no | KEEP-WITH-REASON: manual QA drivers |
| packages/integration/src/dust-seed.mjs | used by preprod-lane | dust tests | lane | KEEP |
| encoder duplicates | 3 impls | encoding tests | http path | CONVERGED (CVG1) |

No three-signal agreement on deletions this pass. src LOC unchanged.
