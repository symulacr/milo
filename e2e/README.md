# e2e/ — R7 option C + E2E-01 harness

Local-only test infrastructure for the Milo campaign. Nothing in this
directory is part of a production bundle.

## Files

| Path | Role |
|---|---|
| `test-jwt-issuer.ts` | R7 option C: ES256 test JWT issuer, env-gated `MILO_TEST_ISSUER=local-only`, local disposable Convex only |
| `r7c-prod-boundary.test.ts` | Boundary proofs: issuer absent from production config + production bundles (demo-boundary style) |
| `e2e-01/run.ts` | E2E-01 happy-path harness scaffold. 3× consecutive passes required for DONE. Does **not** mark D3d done. |

## R7 option C gates (all must hold)

1. `MILO_TEST_ISSUER=local-only` (exact value)
2. Target `CONVEX_URL` is loopback/local (ports 3200–3299). `*.convex.cloud` refused.
3. `NODE_ENV !== production`
4. Private keys stay in-process; tokens are never logged

Label for receipts: `local-convex+test-issuer`

## Proposed `convex/auth.config.ts` change (coordinator applies)

This agent does **not** edit `convex/**`. See `PROPOSED_AUTH_CONFIG_SNIPPET`
export in `test-jwt-issuer.ts` for the exact shape: a second `customJwt`
provider is appended **only** when `MILO_TEST_ISSUER=local-only`, with `jwks`
pointing at the local test JWKS server. When the env gate is unset, providers
remain Privy-only (`api.privy.io`).

## Commands

```sh
# Boundary + issuer unit tests
bun test e2e/

# CLICK-MAP route drift check (coordinator hot file — read-only)
bun clickmap-harness/verify-routes.ts /home/eya/milo/milo-main/CLICK-MAP.md

# E2E-01 harness (option C). Exit 2 = blocked (auth not ready), 1 = <3 passes
MILO_TEST_ISSUER=local-only CONVEX_URL=http://127.0.0.1:3210 \
  bun e2e/e2e-01/run.ts --auth C --runs 3
```

## D3d status

D3d stays **not done**. The harness reports `d3dMarkedDone: false` always.
Three consecutive passes must be produced and independently verified
(video/HAR/SRT) before the coordinator checks D3d.
