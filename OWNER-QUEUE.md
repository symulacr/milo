# OWNER-QUEUE.md

| ID | DECISION | WHY OWNER-ONLY | OPTIONS | IMPACT | BLOCKING |
|---|---|---|---|---|---|
| O-PRIVY-AUTH | accept/reject SIWE login change | product auth policy | A email+test accounts / B SIWE / C local test issuer | D3b D3d E2E | yes for demo E2E |
| O-PRIVY-TEST | enable Privy test accounts | owner Dashboard only | enable / stay off | blocks D3b/D3d/D3e/E2E-01 | yes for demo E2E |
| O-PUSH | push to symulacr/milo | remote write | push / wait | public tip | no |
| O-HOST | public demo hosting | prod deploy | vercel / other | judge URL | no |
| O-LIVE-STRIPE | Stripe live mode | money | stay test | prod payments | yes for PR |
| O-MAINNET | mainnet | funds risk | stay preprod | scope | yes for prod |
| O-RATIFY-STAGE | ratify STAGE-MAP | product policy | ratify / edit | labels | no |
| O1 | acceptance 0/14 vs 14/14 wording | scoring | dual-state / flip | form | no |
| O2 | receipts in git | evidence policy | track / local | audit | no |
| O3 | CI | infra | ship / local | quality | no |
| O5 | reconciliation.ts extract | style | keep / split | code | no |
| F-22 | escalateUnreviewed empty evidence | protected contract | document / owner change | contract | yes for that row |
| F-24 | never-read digests | privacy product | document residual | copy | no |
| M8 | Lace gap acceptance | product | accept gap / require Lace | MVP | no |
| O-PRIVY-SDK | replace @privy-io/react-auth with Better Auth | changes the LIVE Convex auth provider; signs out every existing user | A authorize the deploy / B accept the duplication | 82 duplicate copies, 369 MB -> 103 MB | no (row recorded as an accepted limitation) |

## O-PRIVY-SDK — detail

Recorded as an accepted limitation on 2026-10-12. The replacement is authorized in principle
and priced, but it cannot be completed without changing the live Convex deployment, and that
was not authorized. So the duplication stands, and the row is closed on this basis.

- **Priced**: Better Auth + the official `@convex-dev/better-auth` component installs as 36
  packages / 6,773 files / 103 MB, against the 68,200 files / 369 MB it would remove.
- **Prepared**: commit `7d5dd3a` made the backend identity gate provider-neutral, so the swap
  is now one provider binding plus two frontend files rather than a 15-site rewrite. The
  prototype and its 36 tests are in `hardening/v8/auth-swap/`, and the measured surface is 15
  call sites across 9 modules (an earlier note said 25; that counted imports and the definition).
- **Why it is owner-only**: Better Auth reaches Convex as a component and must be registered in
  a `convex/convex.config.ts` that does not exist; the generated API still declares
  `components: {}`. Registering it needs Convex codegen, which is not offline — even under
  `--dry-run` it prints "Downloading current deployment state..." and "Uploading functions to
  Convex...". With a deploy key present, completing the swap changes the live auth provider.
- **Two routes, and the cheaper one was found later**: the component route runs Better Auth
  *inside* Convex (no new service to operate) but needs component registration plus codegen.
  The other route leaves Better Auth as a normal service and points Convex at its JWTs through
  Convex's generic `customJwt` provider — the exact same shape `convex/auth.config.ts` already
  uses for Privy (`issuer`, `applicationID`, `algorithm`, `jwks`), with Better Auth's JWT plugin
  serving JWKS at `/api/auth/jwks`. That route needs **no component, no codegen and no
  component push**: one `auth.config.ts` change and one env value, plus somewhere to run the
  auth service. Either way the deployment must be updated — no replacement provider can be
  reached without one — but the second is a materially smaller ask, and it is the route to
  prefer if the goal is to retire `@privy-io/react-auth` with the least deployment surgery.
- **Already recovered without it**: the runtime cost was removed in `f869a7c` — eager workspace
  JS fell from 5,490,710 B to 477,994 B (-91.3%) by enabling `splitting` and making
  `RecoveryKitPanel` lazy, so the EVM subtree no longer loads on first paint.
- Details and the three traps found while attempting it: `audit/discovery/U1-dependency-research.md`.
