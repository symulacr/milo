# U6 Midnight integration upgrade — first milestone review

Date: 2026-09-30
Branch: `wt/R6-D2c`
Claim: U6 first milestone only (provider factory · typed error taxonomy · network guard)
Evidence IDs: `obs_u6_factory_unit_1`

**Scope honesty.** U6 in TODO.md is a multi-bullet upgrade (observer + provider
factory and more). This landing covers **only the three first-milestone items
named in the A3 claim**. The remaining U6 surface is listed in §4 and is
**NOT DONE**.

---

## 1. What landed (first milestone)

### 1.1 One provider-assembly factory (shared)

| Piece | Path | Used by |
|---|---|---|
| Factory core | `packages/midnight-client/src/provider-factory.ts` | midnight-client **and** integration |
| Node/testkit adapter | `packages/integration/src/provider-assembly.mjs` | local drivers (wallet/dust/fund dedupe) |
| Structural prepare path | `packages/midnight-client/src/circuits.ts` → `assembleProviders` | apps/web buyer-reserve-runtime |

`assembleProviderFactory` is the single construction point for the six required
`MidnightProviders` slots (01-blueprint §3.7). It owns:

- network guard application (compile-time + runtime)
- fail-closed contract address
- shared `walletProvider` wrapper (balance → signRecipe → finalizeRecipe)
- shared `proofProvider` wrapper (emit start/completion)
- shared `midnightProvider` wrapper (beforeSubmit hook + emit txId)

`packages/integration/src/provider-assembly.mjs` re-exports the factory and adds
the Node/testkit wiring that was previously copy-pasted across
`local-happy.mjs`, `local-ops.mjs`, `local-circuit-sweep.mjs`, and `local.mjs`:

- `walletActorFromTestkit` — structural actor check
- `waitForPositiveDust` / `skipEstimateBalanceTx` — skip-estimate balance path
  (the R8 path that avoids `estimateTransactionFee` on proved call txs)
- `fundBuyerFromGenesis` — genesis mint → buyer transfer → observed finality →
  DUST ready (shared fund wiring)
- `buildLocalProviders` — six-slot assembly through the one factory
- `isInsufficientDust` — taxonomy-first, dust.mjs shape-walk fallback

**NOT DONE (factory):** live call-site migration of `local.mjs` /
`local-ops.mjs` onto `buildLocalProviders` (those two still hold inline
assembly with lane-specific preflight/fence hooks). `local-happy.mjs` and
`local-circuit-sweep.mjs` migration is also **NOT DONE** in this commit so the
diff stays reviewable; the adapter exists and is unit-tested for the wrappers.

### 1.2 Typed error taxonomy (`packages/midnight-client/src/errors.ts`)

Four codes, subclassed off `MidnightClientError`:

| Code | Class | Classifier input |
|---|---|---|
| `REJECTED_SIGNATURE` | `RejectedSignatureError` | `Wallet.Sign` tag, named throw |
| `LOCKED_WALLET` | `LockedWalletError` | not-connected / ConnectionError messages |
| `WRONG_NETWORK` | `WrongNetworkError` | network-guard throws, network messages |
| `INSUFFICIENT_DUST` | `InsufficientDustError` | `Wallet.InsufficientFunds` + `tokenType: dust` |

- `classifyMidnightClientError` folds Effect FiberFailure / `Fail` /
  `Transacting` / `Sequential`/`Parallel` graphs into one code (same walk shape
  as `packages/integration/src/dust.mjs`).
- `rethrowAsMidnightClientError` wraps matching upstream errors; non-matching
  errors are re-thrown unchanged (no silent remapping).
- Throw sites updated: `network.ts`, `wallet.ts`, `wallet-sdk-connector.ts`,
  factory wrappers. Prepare-path validation (`assertRevision`,
  `assertBuyerState`, …) stays plain `Error` — those are input validation, not
  wallet/network/fee failures, and were **not** force-fit into the four codes.

### 1.3 Network guard (compile time + run time)

`packages/midnight-client/src/network.ts`:

| Switch | Allowed id | Compile-time type | Runtime assert |
|---|---|---|---|
| `preprod-only` | `"preprod"` | `NetworkForGuard<"preprod-only"> = SupportedMidnightNetwork` | `assertNetworkGuard(n, "preprod-only")` / `assertSupportedNetwork` |
| `undeployed-only` | `"undeployed"` | `NetworkForGuard<"undeployed-only"> = LocalDisposableNetwork` | `assertNetworkGuard(n, "undeployed-only")` / `assertLocalDisposableNetwork` |

- `NETWORK_GUARD_ALLOWED` is the runtime twin of `NetworkForGuard`.
- Failures throw `WrongNetworkError` (taxonomy), never coerce.
- `encodeNetworkLabel` refuses unknown ids.
- Consistent with `packages/backend/src/public-config.ts`
  (`midnightNetwork: z.literal("preprod")`) and
  `packages/integration/src/config.mjs` (`MILO_LOCAL_NETWORK_ID === "undeployed"`).

---

## 2. Code-vs-blueprint deltas

| Blueprint (01-blueprint §3.7 / §9.1) | Code now | Delta |
|---|---|---|
| One typed `MidnightProviders` tuple per (network, wallet, actor, artifact version) in `packages/midnight-client` | `provider-factory.ts` builds the tuple; `AssembledProviders` carries `network` + `guard` + `contractAddress` | Actor/artifact-version binding still caller-owned; no artifact fingerprint in the assembly record yet |
| Six required slots MID-P1..P6 | `MidnightProviderSlots` = exactly those six; `missingProviderSlots` fails closed | Acceptance rows `midnight.provider.*` remain **partial** (pre-existing; not closed here) |
| Optional logger is not a seventh provider | Factory does not take a logger slot; `onEvent` is a diagnostic sink only | Matches |
| Structured error codes map to actionable messages (§9.3) | Four-code taxonomy + classifiers | Actionable UI copy mapping is apps/web's job (`buyer-reserve-runtime.ts` PREPARE_COPY) — unchanged here |
| Exact network profile; refuse live payment keys in demo/CI (§9.3) | `preprod-only` / `undeployed-only` switches | Mainnet remains blocked everywhere the client can reach |
| `packages/midnight-client/` = provider assembly and transaction lifecycle (§9.1) | Assembly landed; lifecycle still prepare-only (`WALLET_SIGNED_RESERVE_RUNTIME = "UNKNOWN"`) | Proof/submit lifecycle not in this milestone |
| DUST funding mandatory; sponsor optional | `fundBuyerFromGenesis` covers testkit funding; no sponsor path | Sponsor **NOT DONE** |

---

## 3. Verification

```
cd packages/integration && node --test test/provider-factory.test.mjs
```

**11/11 pass** (`obs_u6_factory_unit_1`):

- taxonomy: four codes, subclass instanceof base
- taxonomy: classifiers fold wallet-sdk / Effect shapes
- taxonomy: rethrowAs wraps matching errors only
- network guard: compile-time modes have runtime allow-lists
- network guard: preprod-only rejects undeployed and vice versa
- network guard: encodeNetworkLabel refuses unknown ids
- factory: assembles six slots through wallet/proof/submit wrappers
- factory: wrong network and empty address fail closed
- factory: missing slots rejected by structural assembly
- factory: balance/proof/submit failures classify to taxonomy codes
- factory: beforeSubmit hook runs and submit still emits txId

```
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

Typecheck of the new modules (`errors.ts`, `network.ts`, `provider-factory.ts`,
`circuits.ts`) is clean under `tsc --noEmit`. Repo-wide typecheck still reports
pre-existing missing-root-`node_modules` errors in `apps/web` (react/router
types) — those are unchanged and out of U6 scope.

---

## 4. What remains (U6 NOT DONE)

These are the rest of the U6 “Midnight integration upgrade” surface. None were
attempted in this milestone:

| Remaining item | Why it is out of first milestone | Sketch |
|---|---|---|
| **Observer service** | Separate service budget; 06-backend-design keeps bounded Convex observer only | EffectStream reader spike after a measured gap (08-midnight-core-audit); never a Convex-instantiated secret-bearing provider tuple |
| **Indexer codegen** | Generated decoder must match Milo's actual layout first | Positional EffectStream decoder cannot express structs/vectors/enums; use documented generated-decoder path only after verifying `packages/contract/generated` layout |
| Live call-site migration onto `buildLocalProviders` / `fundBuyerFromGenesis` | Diff safety; lane-specific hooks (resource preflight, submission fences) must move with care | `local.mjs` `beforeSubmit` is already supported by the factory; migrate one lane per commit |
| Browser prove/balance/submit lifecycle | Wave B; `WALLET_SIGNED_RESERVE_RUNTIME` stays `UNKNOWN` | Real Lace session end-to-end |
| MID-P1..P6 acceptance rows | Need positive/negative/real-execution evidence, not assembly | `midnight.provider.private-state` … `midnight.provider.submission` |
| Artifact-fingerprint binding in the assembly record | Factory currently records address + network + guard only | Add compiler/artifact hashes to `AssembledProviders` |
| Sponsor / alternative proof path | Optional per blueprint; DUST funding is the mandatory path | Exactly one proof path per action |
| PERF-QUALITY-REPORT (U7) | Depends on U6 landing | before/after/delta on this factory vs duplicated assembly |

---

## 5. Files touched

| File | Change |
|---|---|
| `packages/midnight-client/src/errors.ts` | **new** — typed error taxonomy |
| `packages/midnight-client/src/network.ts` | network guard (preprod-only / undeployed-only) |
| `packages/midnight-client/src/provider-factory.ts` | **new** — one provider-assembly factory |
| `packages/midnight-client/src/circuits.ts` | prepare path uses the factory; `.ts` import extensions |
| `packages/midnight-client/src/index.ts` | export errors + factory + guards |
| `packages/midnight-client/src/wallet.ts` | typed `LockedWalletError`; `.ts` imports |
| `packages/midnight-client/src/wallet-sdk-connector.ts` | typed errors; `.ts` imports |
| `packages/integration/src/provider-assembly.mjs` | **new** — Node/testkit face of the factory |
| `packages/integration/test/provider-factory.test.mjs` | **new** — 11 unit tests |
| `tsconfig.json` | `allowImportingTsExtensions` (Node 26 type-stripping consumers) |
| `audit/discovery/U6-integration-review.md` | this file |

No contract edits. No TODO.md edits. No secrets. No push.
