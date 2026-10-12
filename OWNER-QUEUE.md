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
| O-PRIVY-SDK | deploy the Better Auth provider | changes the LIVE Convex auth provider; signs out every existing user | authorize the deploy / leave as-is | code swap DONE (bd76db6); deployment pending | no - repository is complete |

## O-PRIVY-SDK — detail

**DELIVERED in code on 2026-10-12** (`bd76db6`). The SDK is gone: `bun.lock` fell from 1,797
lines to 392 with **zero** references to viem, `@walletconnect`, `@reown`, wagmi, `@privy-io`,
`@coinbase/wallet-sdk`, `@metamask` or `@base-org`, and a clean reinstall took `node_modules`
from **1,165 MB to 344 MB** (-821 MB, -70%) with the EVM stack absent from disk. All gates stayed
green through it. The route taken was Convex's generic `customJwt` rather than the Better Auth
Convex component, so there is no component to register and no codegen run.

**One step remains, and it is a deployment, not a change to this repository**: set
`BETTER_AUTH_URL` on the Convex deployment and deploy the changed `convex/auth.config.ts`.
Until that happens the live deployment still validates the previous provider, so sign-in will
not work even though the code is conformant. Also worth knowing: `bun install` does not prune
extraneous packages, so without a clean reinstall the retired files stay on disk unreferenced.

Earlier note, retained for the record: The replacement is authorized in principle
and priced, but it cannot be completed without changing the live Convex deployment, and that
was not authorized. So the duplication stands, and the row is closed on this basis.

- **Priced**: Better Auth + the official `@convex-dev/better-auth` component installs as 36
  packages / 6,773 files / 103 MB, against the 68,200 files / 369 MB it would remove.
- **Prepared**: commit `7d5dd3a` made the backend identity gate provider-neutral, so the gate
  itself is one provider binding rather than a 15-site rewrite. The prototype and its 36 tests
  are in `hardening/v8/auth-swap/`, and the measured gate surface is 15 call sites across 9
  modules (an earlier note said 25; that counted imports and the definition).

  **The full migration is larger than the gate surface suggests, and this was understated
  earlier.** Beyond the gate binding it needs: a restructure of `PrivyConnection.tsx` (~200
  lines — its Convex `useAuth` adapter disappears entirely in favour of Better Auth's
  `ConvexBetterAuthProvider`), `RecoveryKitPanel.tsx`, the Privy test mock, `public-config.ts`
  and its tests, `Connections.tsx`, and — if the legacy issuer fallback is removed at cutover
  rather than left in place — **~66 identity fixtures across 15 files**. Plus a running Better
  Auth service. "One binding plus two frontend files" was the cheap half only.
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
  **The claim values are now MEASURED, not assumed** (2026-10-12, `hardening/auth-probe/`):
  `iss` and `aud` are both the Better Auth base URL, so the config needs **one** environment
  variable, not three - `BETTER_AUTH_URL`, with the JWKS at `${BETTER_AUTH_URL}/api/auth/jwks`.
  `sub` is a 32-character opaque id, and tokens live 900 s. Two traps were confirmed against a
  real instance: the `jwt()` plugin defaults to `EdDSA`/`Ed25519` which Convex REJECTS, and the
  fix must be nested as `jwt({ jwks: { keyPairConfig: { alg: "RS256" } } })` - passing
  `keyPairConfig` at the top level is silently ignored, with no error.
- **Wallet auth in Better Auth — checked, and it does not help here (2026-10-12)**: Better Auth
  ships an official **SIWE** plugin (`better-auth/plugins/siwe`, ERC-4361) with a
  `walletAddress` table, and there are community Solana equivalents (`better-auth-solana`,
  namespace `siws`). What it does *not* have is any Midnight or non-EVM support, and SIWE is
  intrinsically EVM-shaped: `0x` addresses, an EIP-155 `chainId`, and a `verifyMessage`
  function the adopter must supply — in practice via viem, which is one of the five EVM
  packages (560 KB of the workspace bundle, 35 MB on disk) that replacing Privy is meant to
  remove. Adopting SIWE would therefore trade Privy's EVM stack for SIWE's EVM crypto rather
  than retire it. For a Midnight app the wallet-native route remains the one that fits:
  1AM's `signData` verified by `ledger.verifySignature`, which needs no EVM dependency at all
  and was proved to round-trip locally. Better Auth's value here is email, social and passkey
  identity, none of which requires a wallet plugin.
- **Why the frontend half was not written anyway (2026-10-12)**: it was attempted and reverted.
  It means authoring the Better Auth integration against an API that has never been executed
  here, for a token flow whose `iss`/`aud` claim values only a running Better Auth instance
  reveals. The failure mode is silent: the suite mocks the auth provider, so a broken
  integration passes every gate green and surfaces only when a real user cannot sign in. The
  packages were removed rather than left installed, because unused they would have added 103 MB
  to the very footprint this entry exists to reduce. The work needs a runnable Better Auth
  service to be done honestly, not more effort.
- **Already recovered without it**: the runtime cost was removed in `f869a7c` — eager workspace
  JS fell from 5,490,710 B to 477,994 B (-91.3%) by enabling `splitting` and making
  `RecoveryKitPanel` lazy, so the EVM subtree no longer loads on first paint.
- Details and the three traps found while attempting it: `audit/discovery/U1-dependency-research.md`.
