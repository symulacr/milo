# U4 dependency reduction ROI

Date: 2026-10-11 (refreshed; candidates dated 2026-09-30)

| Candidate | Action | ROI evidence | Verdict |
|---|---|---|---|
| hand-rolled HMAC (removed R4) | already @noble/hashes | 117 LOC crypto gone; 12 KATs | DONE |
| typescript 7.0.2 | hold on 5.9.3 | major; typecheck clean on 5.9.3 | SKIP major |
| firecrawl-cli | not a dependency | absent from `package.json` and `bun.lock`; `node_modules/firecrawl-cli` absent | REMOVED, but `research:developer` still points at it (see below) |
| dual lockfiles | bun.lock at root + `packages/integration/package-lock.json` | both present in tree | REVIEW |
| demo.gif / large assets | LFS or drop | size scan | REVIEW |

Removals deferred to U5 after knip/jscpd.


## Removals executed

| Package | Before | After | ROI |
|---|---|---|---|
| firecrawl-cli | devDep | removed | absent from `package.json` and `bun.lock` |
| zod | dep | removed | zero imports in apps/packages/convex/scripts |


## Reverted

`zod` removal reverted: `packages/backend/src/public-config.ts` imports zod
(`z.url()`). Re-added `zod@4.6.5`. Grep miss was `--glob '!*.md'` plus
`from "zod"` vs namespace import.


## Open follow-ups (verified 2026-10-11)

- `firecrawl-cli` was removed from the dependency set, but `package.json` still carries
  `"research:developer": "sh scripts/with-bun.sh node_modules/firecrawl-cli/dist/index.js developer"`.
  That path does not exist, so the script fails as written. Either restore the devDependency or
  remove/repair the script.
- `zod@4.6.5` is pinned in `package.json` and resolved in `bun.lock`; the removal is correctly
  reverted.
