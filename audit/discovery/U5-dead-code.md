# U5 dead code / duplication (2026-09-30)

Evidence: `obs_u5_scan_1` (rg + knip-style export scan).

## Removed

- `packages/integration/src/d2c-split.mjs` — one-shot D2c helper superseded by preprod-lane.
  (kept if still needed — see git history)

## Kept with justification

| Item | Why kept |
|---|---|
| hex helpers in http.ts | @noble path for HMAC; hex utils still used for signatures |
| recovery-kit ops | M6 wired; domain package |
| wallet-sdk-connector | D3c injection surface |
| clickmap-harness | D3a verification |

## Open (not deleted)

- `packages/integration/package-lock.json` (178KB) vs root bun.lock — dual manager; removal needs Node harness proof.
- 1103-line volume-batch / 1501-line preprod-lane splits — large, evidence-referenced; split is U6.

## Marker scan (source)

5 hits (2 ts-expect-error tests, 3 biome-ignore with reasons) — MK1 row.
