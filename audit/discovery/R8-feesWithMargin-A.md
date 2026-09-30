# R8-A — product-side fee fix + minimal repro (Agent A, wt/R6-D2c)

Date: 2026-09-30
Branch: wt/R6-D2c
Evidence IDs: `obs_r8_fee_spin_repro_1`, `obs_r8_fee_math_unit_1`, `obs_r8_fee_math_install_1`

## Root cause (confirmed, pinned file:line)

`wallet-sdk-dust-wallet/dist/v1/Transacting.js` (sha256 `88a33db619ab64b99cdad0ac83ecba01251740475d4e18b84f30103e8663066f`):

| Line | Symbol | Behavior |
|---|---|---|
| 222 | `calculateFee(transaction, ledgerParams)` | calls `transaction.feesWithMargin(...)` on the **proved** object |
| 223 | `feesWithMargin` | WASM `wasm.transaction_feesWithMargin` — **spins** on proved call txs |
| 233 | `dryRunFee` | `transactions.map((tx) => tx.eraseProofs())` before the same `calculateFee` |
| 248 | `computeBalancingRecipe` | iterates fee fixed-point |
| 250 | initial fee | `feeImbalance(transaction, this.calculateFee(transaction, ledgerParams))` on proved tx |

Deploy txs balance in ~20 ms on the same path. Proved call txs hang (~300% CPU).

## Version matrix (ledger-v8 8.1.2 cohort)

| Package | Version | Role |
|---|---|---|
| `@midnight-ntwrk/ledger-v8` | **8.1.2** | WASM `feesWithMargin` / `eraseProofs` |
| `@midnight-ntwrk/wallet-sdk` | 1.2.0 | facade `calculateTransactionFee` / `balanceUnboundTransaction` |
| `@midnight-ntwrk/wallet-sdk-dust-wallet` | transitive | `calculateFee`, `dryRunFee`, `computeBalancingRecipe` |
| Midnight.js / testkit | 4.1.1 | local/preprod providers |
| `compact-runtime` | 0.16.0 | generated contract runtime |
| `onchain-runtime-v3` | 3.1.1 | pinned cohort |

U2 COHORT-UPGRADE forbids bumping Midnight cohort in the main line.

## Product-side fix (in-tree, not a node_modules patch)

`packages/integration/src/fee-math.mjs`:

1. **`installFeeMath()`** — wraps `Transaction.prototype.feesWithMargin` to price
   `this.eraseProofs()` via the *original* implementation (matches `dryRunFee`).
2. **Local-only fixed fee** — `MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only`
   returns `LOCAL_FIXED_FEE_SPECKS = 2_000_000_000n`. Refuses any other ack string
   and refuses `networkId` outside `{undeployed, local}`. **Never Preprod/Mainnet.**
3. **`probeFeesWithMargin()`** — watchdog probe; documents that a sync WASM spin
   needs a worker/child to interrupt.

Wired into `packages/integration/src/local-happy.mjs` (install after ledger import,
emit `fee-math-installed`). `packages/integration/src/dust.mjs` remains the
retry/readiness helper; callers that go through `local-happy` / `fee-math` get
the eraseProofs price.

## Minimal repro

`packages/integration/src/fee-spin-repro.mjs` modes:

- `static` (default) — pins Transacting.js line numbers + SHA-256, records the
  dryRunFee vs calculateFee asymmetry. **Ran: obs_r8_fee_spin_repro_1.**
- `synthetic` — imports ledger-v8, installs both fee-math modes, proves
  Preprod refusal. **Ran: obs_r8_fee_math_install_1.**
- `live` — optional local-network timing of proved call tx (not run this session;
  local disposable lane not brought up).

Output: `audit/discovery/R8-fee-spin-repro.json` + `.md`.

## Unit tests

`packages/integration/test/fee-math.test.mjs` — **6/6 pass** (`obs_r8_fee_math_unit_1`):

- default erase-proofs config
- exact ack string required
- Preprod/Mainnet refused for fixed fee
- eraseProofs wrapper returns erased-copy fee (no recursion)
- local-fixed returns 2000000000n and refuses non-local
- probe times out a spinning (async-hang) feesWithMargin

```
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

## Fixed-fee path locality

`MILO_ALLOW_FIXED_LOCAL_FEE` is **local-only** by construction:

```
MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only  + networkId=undeployed → local-fixed
MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only  + networkId=preprod   → throws
MILO_ALLOW_FIXED_LOCAL_FEE=anything-else                                → throws
unset                                                                     → erase-proofs
```

## NOT DONE

- Live proved-call timing on local disposable chain (needs `bun run test:native-node` lane).
- Preprod real-fee happy path (D2c) — see D2c section of the session report.
- node_modules patch of dust-wallet `calculateFee` itself (U2/OWNER cohort decision).
- `dust.mjs` `balanceWithDustReadiness` still calls `wallet.calculateTransactionFee` /
  `estimateTransactionFee` directly; those now see the patched prototype **iff**
  `installFeeMath` ran first. Preprod lane should install before any balanceTx.

## Commands

```
node --test packages/integration/test/fee-math.test.mjs     # 6/6
node packages/integration/src/fee-spin-repro.mjs            # static pin
MILO_FEE_REPRO=synthetic node packages/integration/src/fee-spin-repro.mjs
```
