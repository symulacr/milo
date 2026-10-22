# U1 dependency research (npm view)

Date: 2026-10-11 (refreshed; earlier figures dated 2026-09-30 were stale)

Pinned column is read from `package.json` and cross-checked against `bun.lock`. Latest column is
from the npm registry as read on 2026-10-11.

| Package | Pinned (package.json) | npm latest |
|---|---|---|
| `@biomejs/biome` | `2.5.14` | `2.5.15` |
| `@midnight-ntwrk/compact-runtime` | `0.16.0` | `0.19.0` |
| `@midnight-ntwrk/dapp-connector-api` | `4.0.1` | `4.0.1` |
| `@midnight-ntwrk/onchain-runtime-v3` | `3.1.1` | not verified |
| `@noble/hashes` | `1.8.0` | `2.4.0` |
| `@privy-io/react-auth` | `3.40.0` | `3.47.0` |
| `@types/bun` | `1.4.2` | not verified |
| `@types/node` | `24.13.3` | `26.6.5` |
| `@types/react` | `19.3.0` | `19.3.0` |
| `@types/react-dom` | `19.3.0` | not verified |
| `axe-core` | `4.13.0` | `4.13.0` |
| `convex` | `1.46.0` | `1.46.0` |
| `happy-dom` | `20.14.5` | not verified |
| `playwright` | `1.63.0` | not verified |
| `radix-ui` | `1.6.7` | `1.7.0` |
| `react` | `19.3.0` | `19.3.0` |
| `react-dom` | `19.3.0` | not verified |
| `react-router` | `8.4.0` | `8.4.0` |
| `stripe` | `22.6.2` | `23.0.0` |
| `typescript` | `5.9.3` | `7.0.2` |
| `zod` | `4.6.5` | `4.6.6` |

`firecrawl-cli` is NOT a dependency: it is absent from `package.json` and from `bun.lock`, and
`node_modules/firecrawl-cli` does not exist. The `research:developer` script still points at
`node_modules/firecrawl-cli/dist/index.js`, so that script cannot run as written.

Midnight cohort versions are managed under U2 (no main-line bump).

## Duplicate packages: the `@privy-io/react-auth` EVM wallet subtree (assessed 2026-10-12)

Measured on the current tree: **57 packages installed at more than one version, 82 extra
copies beyond the first.** `@noble/hashes@1.8.0` is already deduped wherever semver allows,
so the remainder are genuine range conflicts rather than a configuration miss.

Every one of them is transitive from `@privy-io/react-auth@3.40.0`'s EVM wallet subtree, which
Milo never uses - it imports Privy in two files and only for identity (`PrivyConnection.tsx`,
`RecoveryKitPanel.tsx`). The subtree is 68,200 files, but its size depends on how it is
counted, and the first figure recorded here was wrong: a raw sum of logical file bytes gives
313.3 MiB, but that counts a hardlinked file once per path. `du --count-links` gives 531 MB of
blocks and `du` proper gives **348 MB unique** - bun installs from a content-addressable cache
and hardlinks shared files, so 183 MB of the counted total is links, not data. Against a
`node_modules` of 1,136 MB unique (1,472 MB counted), the subtree is **31% of the unique
total**. Led by `@reown` 110 MB unique, viem 71 MB, `@walletconnect` 51 MB, `@metamask` 37 MB.

**Not removable by configuration.** The connectors are declared dependencies of
`@privy-io/react-auth` and are statically imported by its own entry (`dist/esm/index.mjs` ->
`wallet-connect-*.mjs`, `useSendTransaction-*.mjs`), so no import specifier, alias or bundler
option drops them - only replacing that package does. A connector-free path does exist:
`@privy-io/js-sdk-core@0.73.0` is already installed and declares zero EVM connector
dependencies. But adopting it means hand-writing the login surface over it, which
`03-building-guide.md` § 1.5 forbids: *"Never delete a failure test, remove a coverage
requirement, or build bespoke auth merely to preserve a number"*, and *"a smaller direct count
that shifts risk into transitive packages is not relief."*

**Verdict: accepted limitation.** The runtime cost was removed instead. Enabling `splitting`
in `scripts/build.ts` and making `RecoveryKitPanel` a lazy import cut the eager workspace JS
from 5,490,710 B to 477,994 B (-91.3%), deferring this subtree to chunks that load only when
the authenticated branch renders. Revisit only if a product requirement adds EVM chain
support, which would give the subtree a real job instead of leaving it dead weight.

Two further routes were checked and rejected. No install flag reaches the connectors: all five
sit in `dependencies`, not `optionalDependencies` or `peerDependencies`, so `--omit=optional`
and its kin do nothing. And `npm dedupe` is the wrong tool for this tree - the repo installs
with bun (`bun.lock`), so an npm restructure would desync it, and the dry run also moves
`cross-fetch` 3.2.0 -> 4.1.0, a major. A content-addressable package manager would make the
duplicates impossible by construction, but that is a toolchain change the cohort policy owns.

### Update: the SDK replacement is authorized, started, and blocked on a deployment

The owner authorized replacing `@privy-io/react-auth` with Better Auth plus the official
`@convex-dev/better-auth` component. The work is staged in `hardening/v8/auth-swap/`
(prototype, 36 tests) and the first stage has landed:

- **Applied** (commit `7d5dd3a`): `packages/backend/src/session-identity.ts` is now the single
  identity gate and names no provider outside its two binding constants. All **15** call sites
  across 9 modules call `requireSessionSubject`; `privy-identity.ts` is deleted. The migration
  surface is 15 sites, not the 25 previously recorded here - that figure had counted import
  lines and the function definition.
- **Priced**: Better Auth plus the Convex component installs as 36 packages / 6,773 files /
  103 MB, against the 68,200 files / 369 MB it removes.

**Blocked, and why it is not a code edit.** Better Auth reaches Convex as a *component*, so it
must be registered in a `convex/convex.config.ts` that does not exist, and the generated API
still declares `export declare const components: {};`. Registering it needs Convex codegen
against a deployment - and `convex codegen` is **not offline**: even under `--dry-run` it
prints `Downloading current deployment state...` and `Uploading functions to Convex...`. A
deployment is wired up here (`.env.local` carries `CONVEX_DEPLOY_KEY`, i.e. write access), so
completing the swap changes the live auth provider and signs out every existing Privy user.
That is an owner decision and has not been given, so the deployment is untouched.

Three traps found while attempting it, for whoever finishes the work:

1. The component declares peer `better-auth >=1.6.11 <1.7.0`. A default install resolves
   `1.7.7`, outside the range - a runtime failure, not a build one. Pin `1.6.x`.
2. The gate's issuer must equal the issuer Convex validates, and `getAuthConfigProvider()`
   derives that from `CONVEX_SITE_URL` **only under the Better Auth provider**. `CONVEX_SITE_URL`
   is set here for Convex's own reasons while the token issuer is still `privy.io`, so reading
   it in the gate today would deny every authenticated request. The provider binding and the
   gate must change in one commit.
3. `convex codegen` contacts the deployment, so there is no offline path to a typed Convex-side
   integration. Any attempt will touch the live service.

## Unused declared dependencies: none (checked 2026-10-12)

A naive "is this package imported?" sweep flags nine of the twenty declared packages:
`@biomejs/biome`, `@noble/hashes`, `@types/bun`, `@types/node`, `@types/react`,
`@types/react-dom`, `axe-core`, `react-dom` and `typescript`. **Every one of them is a false
positive**, and the reasons are worth writing down so the next sweep does not delete live code:

| Why the grep misses it | Packages |
| --- | --- |
| Subpath import — `"react-dom"` does not match `from "react-dom/server"` | `react-dom` (`/client`, `/server`), `@noble/hashes` (`/hmac`, `/sha256`) |
| Read by path, not imported — `join(ROOT, "node_modules/axe-core/axe.min.js")`, injected into the page | `axe-core` |
| CLI binary invoked from a package script, never imported | `@biomejs/biome`, `typescript` |
| Resolved by `tsconfig` types, not by an import statement | `@types/*` |

A correct pattern is the package name followed by a subpath slash or the closing quote, and it
must be checked against `package.json` scripts and `tsconfig` as well as source. Note also that
`grep -E` does not support PCRE non-capturing groups: a pattern using `(?:…)` fails silently and
returns nothing, which reads exactly like "no references found".

Conclusion: no declared dependency is removable. The install weight is real, but it is all in
transitive packages, which is the subject of the section above.

**Final verdict: accepted limitation. The row is closed on this basis.**

The duplication stands and is not a defect to be worked around — it is the cost of the auth
provider this deployment runs, and removing it requires a provider change on a live service
that has not been authorized. Delegation was requested twice and not granted, so the
conservative answer holds: leave the deployment alone.

What is already recovered without the migration: the runtime cost, in `f869a7c`. What remains
is install size in a developer and CI tree that is largely hardlink-shared from bun's cache —
1,136 MB unique across all of `node_modules`, of which this subtree is 31%.

The decision is tracked as `O-PRIVY-SDK` in `OWNER-QUEUE.md`, with the priced alternative and
the exact sequence to resume it. Revisit only if a product requirement adds EVM chain support,
which would give the subtree a real job instead of leaving it dead weight.
