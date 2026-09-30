# U4 dependency reduction ROI

Date: 2026-09-30 (candidates only; no removals yet)

| Candidate | Action | ROI evidence | Verdict |
|---|---|---|---|
| hand-rolled HMAC (removed R4) | already @noble/hashes | 117 LOC crypto gone; 12 KATs | DONE |
| typescript 7.0.2 | hold on 5.9.3 | major; typecheck clean on 5.9.3 | SKIP major |
| firecrawl-cli | review as unused in prod | search/grep in scripts | REVIEW |
| dual lockfiles | bun.lock only at root | package-lock in integration | REVIEW |
| demo.gif / large assets | LFS or drop | size scan | REVIEW |

Removals deferred to U5 after knip/jscpd.


## Removals executed

| Package | Before | After | ROI |
|---|---|---|---|
| firecrawl-cli | devDep | removed | unused in source; lockfile −70 lines |
| zod | dep | removed | zero imports in apps/packages/convex/scripts |


## Reverted

`zod` removal reverted: `packages/backend/src/public-config.ts` imports zod
(`z.url()`). Re-added `zod@4.6.5`. Grep miss was `--glob '!*.md'` plus
`from "zod"` vs namespace import.
