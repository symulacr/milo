# IMPLEMENTATION-P2-D2a-reserve.md

| Field | Value |
|---|---|
| Task | **D2a** — local happy path reserve → accept → submitDelivery → approve |
| Stage | local disposable lane (`undeployed`) |
| Date | 2026-09-30 |
| Repo | `/home/eya/milo/milo-main` |
| Label | **SDK-connector** |
| Evidence criterion | four circuit call txHashes + blocks + phase/revision read-back |
| Deliverables | `RECEIPTS-LOCAL.md`, this report |
| Source of truth | `/tmp/d2a-happy-trail.jsonl`, `/tmp/d2a-ops.out`, `/tmp/d2a-local4.out` |

---

## 1. Outcome

**Partial.** Staged bootstrap and staged deploys land reliably (14/14 circuits, verifier-key equality). The four circuit calls did **not** land. Two distinct blockers, both reproduced:

1. **call-tx args bug (fixed in driver, not yet re-proven on-chain)** — `submitCallTxAsync` requires `args: [expectedRevision, …circuitArgs]`. Passing `args: []` for `reserve` throws `ContractRuntimeError`/`CompactError` before any proof. Compare `preprod-actions.mjs:336` (`args: (rev) => [rev]`) and `local-ops.mjs` (`callTx[circuit](item.revision, ...item.args())`).
2. **`wallet.estimateTransactionFee` hang on call txs** — `local-ops.mjs` `call-reserve` emitted `proof-provider-completed` + `dust-base-fee-covered` then burned ~30 min / 3+ cores inside fee estimation with zero further events. Deploy/maintenance txs take the same code path in seconds. Workaround in `local-happy.mjs`: `balanceTx` skips estimation and calls `balanceUnboundTransaction` after a dust-presence wait.

A third issue appeared when re-running: `runStagedDeploy` resume of a **complete** receipt queries `queryContractState` with `offset.blockOffset` and dies (`Oneof input objects requires have exactly one field`, `staged-deploy.mjs:640`). Fresh receipt paths avoid it.

## 2. Circuit call API (SDK-connector)

From `packages/contract/generated/contract/index.js` + `midnight-js-contracts`:

| circuit | TS callTx args | `submitCallTxAsync` `args` | actor witness | revision |
|---|---|---|---|---|
| reserve | `(expectedRevision)` | `[0n]` | buyerSecret | 0 |
| accept | `(expectedRevision)` | `[1n]` | merchantSecret | 1 |
| submitDelivery | `(expectedRevision, commitment32)` | `[2n, delivery]` | merchantSecret | 2 |
| approve | `(expectedRevision, expectedDelivery32)` | `[3n, delivery]` | buyerSecret | 3 |

`approve(expectedDelivery)` must equal the `submitDelivery` commitment (Preprod lesson in `preprod-actions.mjs:548-550`). One shared `delivery` per order.

Use `submitCallTxAsync` + timed `watchForTxData` rather than blocking `submitTx`/`callTx`: SDK docs (`submit-tx.d.ts`) state `submitTx` waits indefinitely on `watchForTxData`. `await-watchdog.mjs` exists for exactly this stall class.

Multi-actor private state is mandatory for merchant circuits: `order.mjs` `freshOrder()` only persists the buyer secret; `local-ops.mjs`/`local-happy.mjs` build buyer+merchant+operator secrets and store `happy-<actor>` via `privateStateProvider`.

## 3. On-chain evidence (see RECEIPTS-LOCAL.md for full tables)

| Run | Address | deploy txHash / block | insert txHash / block | 14 ops | 4 calls |
|---|---|---|---|---|---|
| prior staged bootstrap | `b3088604…bea8` | `0746d21e…` / 701 | `8b59ea5b…` / 704 (+lock `40ade794…` / 707) | yes | n/a (buyer-only secrets) |
| local-ops.mjs | `83e0dda7…cb77b` | `8660076d…` / 941 | `ed778241…` / 944 | yes | hung at reserve |
| local-happy run1 | `73b9f6e9…725ed` | `90f27987…` / 1553 | `19c44bb2…` / 1556 | yes | reserve rejected (args) |
| local-happy run2 | (resume) | same as run1 | same | — | blocked (resume GraphQL) |

Funding txs also recorded in RECEIPTS-LOCAL.md (blocks 1543, 1618).

## 4. Driver notes (`local-happy.mjs`)

- `packages/integration/src/local-happy.mjs` — copy of the `local-ops.mjs` happy path with: `submitCallTxAsync` + `withTimeout` (240s submit / 120s watch), `balanceTx` without `estimateTransactionFee`, `appendFileSync` trail, manual `nextPrivateState` store on `SucceedEntirely`.
- Launch: `/tmp/run-happy.sh` (env from `/tmp/d2a-env.sh` + `MILO_LOCAL_*` endpoints, genesis `0xe72f7a21…`).
- MUST `setsid nohup` — a plain `bash -lc '… &'` reaps the node child when the tool shell exits.

## NOT DONE

- **reserve, accept, submitDelivery, approve: no on-chain txHash/block.** Happy path is not complete.
- Re-run after the `args: [revision, …]` fix was blocked by `runStagedDeploy` resume; needs a clean receipt dir (e.g. new `/tmp/d2a-happy-run-N/`) or a resume fix.
- `dust.mjs` `estimateTransactionFee` hang is bypassed, not root-caused/fixed.
- `staged-deploy.mjs` `offset.blockOffset` resume bug not fixed.
- `immutableOrderAdmission: false`; `r1Complete: false`.
- Adversarial maintenance rejection, canonical quote binding, private recovery, remaining MID ops, preprod happy-path: not run.
- No phase/revision read-back after successful calls (would be `COMPLETED` / `4`).
