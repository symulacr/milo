# R7C report — test JWT issuer + E2E-01 scaffold + CLICK-MAP verify

Branch: `wt/R7C-e2e` · Agent B · 2026-09-30
Labels: `local-convex+test-issuer` · harness reports `d3dMarkedDone: false` always

## Claims attempted

| Claim | Status | Evidence |
|---|---|---|
| R7 option C: local test JWT issuer, env-gated, local disposable Convex only | IMPLEMENTED (tests 19/19) | `e2e/test-jwt-issuer.ts`, `e2e/r7c-prod-boundary.test.ts` |
| Boundary tests: issuer absent from production config + production bundles | IMPLEMENTED (19/19 pass) | `e2e/r7c-prod-boundary.test.ts` |
| CLICK-MAP routes match `apps/web/src/route-table.ts` | VERIFIED — **no drift** | `bun clickmap-harness/verify-routes.ts` → `clickmap-harness/out/clickmap-drift-*.json` |
| E2E-01 harness scaffold under `e2e/` | SCAFFOLD DONE | `e2e/e2e-01/run.ts` |
| D3d E2E-01 3× pass | **NOT DONE** (blocked O-PRIVY-TEST / auth.config patch) | harness exits blocked / not-done; never marks D3d |

## NOT DONE

1. **D3d / E2E-01 3× pass — NOT DONE.** Three consecutive passes are required
   for DONE. The harness refuses to invent passes:
   - Without `MILO_TEST_ISSUER=local-only`: status `blocked` (missing_or_wrong_env).
   - With the gate open but no live local Convex + coordinator `auth.config`
     patch: subsequent steps return scaffold `ok: false` → status `not-done`.
   - `done: false` and `d3dMarkedDone: false` are hard-coded in every summary.
   Owner actions still required (O-PRIVY-TEST, O-PRIVY-AUTH A/B/C, coordinator
   auth.config patch below).

2. **`convex/auth.config.ts` — PROPOSED ONLY (coordinator applies).** This agent
   does not edit `convex/**`. See `PROPOSED_AUTH_CONFIG_SNIPPET` in
   `e2e/test-jwt-issuer.ts`. Shape: when `MILO_TEST_ISSUER=local-only`, append a
   second `customJwt` provider (`issuer: "privy.io"`, `algorithm: "ES256"`,
   `jwks: process.env.MILO_TEST_ISSUER_JWKS` → local JWKS server). When unset,
   providers remain Privy-only (`api.privy.io`). Boundary tests already assert
   the production path is Privy-only.

3. **`.gitignore` allowlist — PROPOSED ONLY.** Repo is deny-by-default (`*`).
   `e2e/`, `clickmap-harness/`, and this report required `git add -f`. Coordinator
   should add (or accept force-added):
   ```
   !/e2e/
   !/e2e/**
   !/clickmap-harness/
   !/clickmap-harness/**
   ```
   Do **not** re-include `e2e/**/out/` receipts if those should stay local.

4. **Real happy-path steps** (`backend-session`, `quote-reserve`,
   `merchant-accept`, `merchant-submit-delivery`, `buyer-approve`) are scaffold
   stubs that return `ok: false` with an explicit "Scaffold step" message. No
   stub passes. They wire up once a token is accepted by local Convex.

5. **CLICK-MAP.md is a coordinator hot file** (on `milo-main`, not this
   worktree). Verified read-only; no edits. Evidence IDs CM-* unchanged.

## Command outputs

### `bun test e2e/` — 19/19 pass

```
e2e/r7c-prod-boundary.test.ts:
(pass) R7C gate — refuses MILO_TEST_ISSUER unset/wrong
(pass) R7C gate — refuses NODE_ENV=production
(pass) R7C gate — refuses cloud and remote Convex URLs
(pass) R7C gate — accepts loopback 3200-3299
(pass) R7C gate — fails closed when Convex URL required but missing
(pass) R7C gate — subject must match did:privy:<id>
(pass) R7C mint — ES256 JWT with Privy-shaped claims
(pass) R7C mint — refuses without env gate
(pass) R7C mint — refuses cloud Convex target
(pass) R7C mint — public JWK never carries private material
(pass) R7C mint — redactUrl strips userinfo
(pass) R7C production config — auth.config.ts Privy-only without gate
(pass) R7C production config — proposed snippet documents coordinator patch
(pass) R7C production config — requirePrivySubject contract documented
(pass) R7C production bundle — workspace/public entries never reach issuer
(pass) R7C production bundle — no apps/web source imports issuer
(pass) R7C production bundle — no convex/** source imports issuer
(pass) R7C production bundle — dist/ (when present) no test-issuer markers
(pass) R7C production bundle — build entrypoints do not list issuer
 19 pass / 0 fail / 321 expect() calls
```

### `bun clickmap-harness/verify-routes.ts /home/eya/milo/milo-main/CLICK-MAP.md`

```
OK: 13 CLICK-MAP routes match route-table.ts (6 public + 6 workspace + prefix sample)
public=["/demo","/sign-in","/how-it-works","/privacy","/terms","/pilot"]
workspace=["/orders","/merchant/orders","/merchant/quotes/new","/operator/cases","/account","/connections"]
prefix=["/m/north-studio"]
```

**Drift: none.** Route table `apps/web/src/route-table.ts:8-36` still matches
CLICK-MAP.md Route index (D3a). `/m/north-studio` remains the `publicAppPrefixes`
sample. Parameterized workspace sub-routes are still intentionally absent from
the table (CLICK-MAP NOT DONE section).

### `bun e2e/e2e-01/run.ts --auth C --runs 3` (gate unset)

```json
{
  "label": "local-convex+test-issuer",
  "status": "not-done",
  "consecutivePasses": 0,
  "requiredPasses": 3,
  "done": false,
  "d3dMarkedDone": false,
  "note": "Auth happy path not proven (0 consecutive passes, need 3). D3d remains blocked/not done."
}
```

Receipt: `e2e/e2e-01/out/e2e-01-C-*.json` — run status `blocked` at step
`auth-gate` (`missing_or_wrong_env`). Exit code 2 (blocked).

With `MILO_TEST_ISSUER=local-only CONVEX_URL=http://127.0.0.1:3210` the
auth-gate opens (label `local-convex+test-issuer`) but later scaffold steps
return `ok: false` → still `not-done`, `d3dMarkedDone: false`.

## file:line references

| Item | Location |
|---|---|
| Test issuer gates + mint | `e2e/test-jwt-issuer.ts:1` (gate `evaluateTestIssuerGate`, mint `mintTestJwt`) |
| Local-URL predicate | `e2e/test-jwt-issuer.ts` `isLocalConvexUrl` (loopback only; refuses `*.convex.cloud`) |
| Proposed auth.config snippet | `e2e/test-jwt-issuer.ts` `PROPOSED_AUTH_CONFIG_SNIPPET` |
| Boundary tests | `e2e/r7c-prod-boundary.test.ts:1` |
| E2E-01 harness | `e2e/e2e-01/run.ts:1` (`runE2E01`, `REQUIRED_PASSES = 3`, `done: false`) |
| CLICK-MAP verifier | `clickmap-harness/verify-routes.ts:1` |
| route-table source of truth | `apps/web/src/route-table.ts:8-36` |
| requirePrivySubject contract | `packages/backend/src/privy-identity.ts:4-12` (read-only) |
| auth.config (unchanged) | `convex/auth.config.ts:1-22` (read-only; Privy-only) |

## Evidence IDs

| ID | Meaning |
|---|---|
| `R7C-BOUNDARY-19` | 19/19 boundary + issuer unit tests pass (`bun test e2e/`) |
| `R7C-CLICKMAP-OK` | 13/13 routes match; zero drift vs `route-table.ts` |
| `R7C-E2E01-SCAFFOLD` | harness scaffold present; 3× pass NOT achieved; D3d not marked |
| `local-convex+test-issuer` | label for any future receipts produced via option C |

## Writable-scope compliance

- Created only under `e2e/**`, `clickmap-harness/**`, `audit/discovery/R7C-report.md`.
- Did **not** edit `convex/**`, `packages/**`, `apps/web/**`, coordinator hot
  files (CLICK-MAP.md, HANDOFF.md, TODO.md, DRIFT-CHECK.md, .gitignore).
- `convex/auth.config.ts` change is **proposed** in this report and in
  `PROPOSED_AUTH_CONFIG_SNIPPET`; coordinator applies.
