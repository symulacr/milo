# RECEIPTS.md

Verified against Midnight Preprod indexer GraphQL  
`https://indexer.preprod.midnight.network/api/v4/graphql`  
Read date: 2026-09-29. Method: `contractAction(address:)` + `block.height`.

## On-chain facts

| Fact | Value | Status |
|---|---|---|
| Network | Midnight Preprod | VERIFIED-ONCHAIN |
| Contract address | `b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586` | VERIFIED-ONCHAIN |
| Latest action type | `ContractUpdate` | VERIFIED-ONCHAIN |
| Latest tx hash | `5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58` | VERIFIED-ONCHAIN |
| Block height (state) | `2639638` | VERIFIED-ONCHAIN |
| Chain height at read | `2765910` | VERIFIED-ONCHAIN |
| Network label in state | `preprod` (ASCII in contract state) | VERIFIED-ONCHAIN |
| Circuit names in state | reserve, accept, submitDelivery, approve, cancelReserved, decline, disputeBuyer, disputeMerchant, resolve, expireBootstrap, expireReserved, expireUndelivered, expireDispute, escalateUnreviewed | VERIFIED-ONCHAIN (state bytes) |

## Contract identity

| Variant | SHA256 | Origin | Verdict |
|---|---|---|---|
| **canonical** | `0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0` | git `1188413` seal wave-5 (current tree) | **USE THIS** |
| older | `8fe02a3949879a87cead236e92414449b2b4ece614d03783b6012cf4ca67bd96` | git `9689fae` v0.0.1 (zip baseline) | superseded |
| mid | `a8c6f3f5…` | git `61182c4` seal constructor | intermediate |

History: `9689fae` → `61182c4` → `1188413`.  
Delta sealed variant vs v0.0.1 is `export sealed ledger` on protocolVersion/configuration.  
**Preprod identity vs source keys:** UNREACHABLE to full verifier-key compare this session (state dump is ledger, not vk hashes). State is live and names match 14 circuits. **Verdict: canonical `0bede3fb`.**

## Execution vs acceptance

| Metric | Value | Note |
|---|---|---|
| Circuits exercised on Preprod | 14 / 14 (prior CHANGELOG + state names) | execution |
| Provider acceptance | 0 / 6 | acceptance |
| Operation acceptance | 0 / 14 | acceptance |

## Stripe (test-mode)

| Item | Value | Status |
|---|---|---|
| Webhook endpoint id | `we_1UL7TWIDa2vgC4L9PfUE2ZAl` | CREATED |
| Endpoint URL | `https://tremendous-rooster-473.convex.site/webhooks/stripe` | configured |
| Secret | stored in `.env.local` | not printed |
| PaymentIntents / capture | not yet | next |

## Convex dev

| Item | Value |
|---|---|
| URL | `https://tremendous-rooster-473.convex.cloud` |
| Site | `https://tremendous-rooster-473.convex.site` |
| Deploy key | in `.env.local` |

## Query used (evidence)

```graphql
query {
  contractAction(address: "b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586") {
    __typename address state transaction { hash block { height } }
  }
}
```

Explorer links: confirm before publishing. Indexer GraphQL is the source of truth used here.

## Local Midnight lane (D2a) — 2026-09-30

| Fact | Value | Status |
|---|---|---|
| Network | local undeployed compose | VERIFIED-ONCHAIN local |
| Genesis | 0xe72f7a21a0397844563b4206f887b779ffa0d937c2d1b2339441faa1f08b9846 | VERIFIED |
| Contract address | b3088604c4d5a08cc48d8037614be5a9391dbbf7736e59374aba5f16a500bea8 | VERIFIED-ONCHAIN local |
| staged-deploy txHash | 0746d21e488f46698910e6fd0bf016f6a0a0a3d54db91c0af080bf07e0e5205c block 701 | VERIFIED |
| staged-install txHash | 8b59ea5be0e0101ed599ada21db7a1e837da9e1485db0c69c9e13698cbcaa48c block 704 | VERIFIED |
| staged-lock txHash | 40ade7947a0f70cb78eaa715b10d422650f838cd00d16e95993ea85ccc2b6a39 block 707 | VERIFIED |
| Operations installed | 14 | VERIFIED |
| Phase | DEPLOYED rev 0 | VERIFIED |
| Maintenance | locked | VERIFIED |
| Label | SDK-connector / harness | — |

## D5 re-query (2026-09-30)
Preprod 0xb95c…e74586 still ContractUpdate tx 5ce74cb9… block 2639638. Chain height 2769087.

## Spend ledger cross-ref (D2b)

The spend tables below list hash, purpose, fee, block and chain height.
Fee estimates were taken **before** submission. Seed material is never printed.

### Local staged-deploy (from `/tmp/d2a-local4.out`)

| hash | purpose | fee (specks, est+margin) | block | chain height |
|---|---|---|---|---|
| `0746d21e488f46698910e6fd0bf016f6a0a0a3d54db91c0af080bf07e0e5205c` | MID-T01-staged-deploy | 30 | 701 | 701 |
| `8b59ea5be0e0101ed599ada21db7a1e837da9e1485db0c69c9e13698cbcaa48c` | MID-T01-staged-install | 29 | 704 | 704 |
| `40ade7947a0f70cb78eaa715b10d422650f838cd00d16e95993ea85ccc2b6a39` | MID-T01-staged-lock | 1 | 707 | 707 |
| **Total** | 3 staged txs | **60** | | |

### Preprod (this file, on-chain facts above)

| hash | purpose | fee | block | chain height |
|---|---|---|---|---|
| `5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58` | ContractUpdate (replaceAuthority) | not captured | 2639638 | 2765910 (read) |

## Preprod D2c happy-path attempt (2026-09-30) — SDK-connector / harness

| Fact | Value | Status |
|---|---|---|
| Network | Midnight Preprod | VERIFIED |
| Allow gate | `MILO_PREPROD_ALLOW=disposable-owned-preprod` | VERIFIED |
| Wallet (unshielded) | `mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7` | VERIFIED |
| NIGHT balance | `35000000000` specks | VERIFIED |
| DUST balance | `0` specks | VERIFIED (blocker) |
| UTXOs | 7 available, 0 pending, all `registeredForDustGeneration` | VERIFIED |
| DUST seed snapshot | `wallet-state/dust.json`, roots verified, cutoff 1575327 | VERIFIED |
| Wallet-state verify | 16/16 PASS, UTXO crosscheck 7=7 | VERIFIED |
| Happy-path tx hashes | none (deploy failed: `could not balance dust`) | **NOT LANDED** |
| Indexer read-back | `ContractUpdate` `5ce74cb9…` block 2639638; tip 2770140 | VERIFIED-ONCHAIN |
| Ingest (deployment) | `observationIngest:recordDeployment` → `{"kind":"recorded","observationId":"obs_d2c_preprod_1"}` | VERDICT: recorded |
| Ingest (chain) | `orders:recordObservation` missing on Convex | VERDICT: blocked |
| Label | SDK-connector / harness | — |
| Seed | `.env.preprod` only — never printed | — |

## Preprod genesis replay (make the funded wallet spendable)

Status: **not yet run.** This runbook documents the procedure; no step here has been
executed against Preprod.

### Why this exists

The Preprod wallet holds 7 registered NIGHT UTXOs and reports `dustBalance: 0`, so it
cannot pay a fee and every spend fails with `InsufficientDustForFee`. The cause is not a
key mismatch: `DustGenerationsItem.owner` is a SCALE-compact field (prefix byte `0x73`,
then the 32-byte key little-endian), so `owner[2:] == reverse(dustKeyHex)` holds exactly
and the DUST generation belongs to this wallet.

The defect is that the dust seeder starts the wallet past its own history. Our 7
`DustInitialUtxo` events sit at dust ledger ids 1539297-1540159, the seeder's cutoff is
1708291, and the SDK's `Sync.js` resumes from `appliedIndex - 1`. A wallet restored from a
collapsed-update seed therefore never requests the skipped range, restores with
`utxos.length === 0`, and can never construct a DUST spend. A guard in
`packages/integration/src/dust-seed.mjs` now makes the seeder fail closed instead of
emitting such a snapshot, so the fast path refuses rather than silently producing an
unspendable wallet.

The only remaining way to make the wallet spendable is to replay dust events from genesis,
which builds `state.utxos` from the events that actually create the leaves.

The refusal is observable today. A read-only `--check` run on this tree reproduces it:

```
{"event":"dust-seed-cutoff-found","cutoffEventId":1710903,"foundAtHeight":3094366,...}
{"event":"dust-seed-failed","reason":"seed-refused","name":"DustSeedError",
 "message":"emitted snapshot holds no dust UTXOs: a collapsed update carries the tree roots
 but not the wallet's own leaves, ...","fallback":"ordinary-full-sync"}
{"event":"preprod-check",...,"address":"mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7",
 "balances":{"connected":true,"synced":false,"night":"35000000000","dust":"0"}}
```

That is the whole defect in one run: NIGHT `35000000000`, DUST `0`, and the seeder refusing
to emit an unspendable snapshot. The cutoff has since advanced past 1708291 (it was 1710903
at height 3094366), which does not change the analysis: the cutoff is always ahead of our
events at 1539297-1540159.

### Command

Run from the repository root. The lane reads `.env.preprod`; the three variables below are
the ones that change behaviour for this procedure.

```sh
cd /home/eya/milo/milo-main

MILO_AWAIT_TIMEOUT_MS=10800000 \
MIDNIGHT_PREPROD_RUN_DIR=/home/eya/milo/milo-main/.hoplite/artifacts/preprod \
  node --env-file=.env.preprod packages/integration/src/preprod-lane.mjs --sync
```

`.env.preprod` begins with a UTF-8 BOM, so `set -a; . ./.env.preprod` does **not** load it
(the first assignment is prefixed with the BOM bytes and is silently skipped). Use
`node --env-file=.env.preprod`, which handles the BOM, or `scripts/spend-balance.mjs`, whose
loader trims each line. Do not paste the seed onto the command line: it would land in shell
history and in the process argv.

Required environment (validated by `preprodConfig` before any network I/O):

| Variable | Value | Why |
|---|---|---|
| `MIDNIGHT_PREPROD_SEED` | 64 hex chars | wallet key material; already in `.env.preprod` |
| `MILO_PREPROD_ALLOW` | `disposable-owned-preprod` | explicit Preprod authorization |
| `MILO_PREPROD_BLOCKFROST_PROJECT_ID` | `nightpreprod…` | appended as `project_id`; a `nightmainnet` token is rejected |
| `MIDNIGHT_PREPROD_PROOF_HTTP` | `http://127.0.0.1:6300` (default) | must be a bare loopback origin; the proof server sees witness data |

`--sync` is the correct mode: it syncs fully and persists the snapshots. Do not use
`--seed-dust`, which is the explicit collapsed-update fast path.

`--sync` does **not** by itself avoid the fast path. `buildSession` is called with
`autoSeedDust: true` for every mode (`preprod-lane.mjs:1298`), so `--sync` also attempts the
collapsed-update seed whenever no restorable snapshot exists. What makes the replay work is
that the seeder **refuses** to emit a zero-UTXO snapshot *for a wallet that has already
registered NIGHT*, and a refusal sets `dustSnapshot = null`, so the wallet starts from an
empty dust state and performs the ordinary full sync. The run trail shows this as
`dust-seed-failed` with `reason: "seed-refused"` and `fallback: "ordinary-full-sync"`.

The refusal is scoped deliberately. A fresh wallet that has never registered NIGHT owns no
DUST UTXOs on chain, so an empty set is its correct state and the fast path still applies to
it. Only a wallet whose NIGHT is already registered is refused, because its DUST UTXOs exist
on chain but predate the seed cutoff. The lane decides which case it is by reading
`registeredForDustGeneration` from the unshielded snapshot (`walletHasRegisteredNight`).

That distinction matters: the replay depends on the seeder failing closed for *this* wallet,
not on the mode flag. If the guard in `dust-seed.mjs` were removed, `--sync` would silently
restore an unspendable wallet again. Do not "fix" the seeder by making it emit the collapsed
snapshot for a registered wallet.

To force a true from-genesis replay, the dust snapshot must be absent. The seeder writes
`<runDir>/wallet-state/dust.json`; if that file exists the wallet restores from it and
resumes at its recorded applied index instead of replaying genesis. Move it aside (do not
delete it) before the run:

```sh
mv .hoplite/artifacts/preprod/wallet-state/dust.json \
   .hoplite/artifacts/preprod/wallet-state/dust.json.pre-genesis-replay
```

**Removing `dust.json` also forces shielded and unshielded to replay from genesis.**
`loadWalletState` reads all three role files inside one `try` block
(`preprod-lane.mjs:368-376`) and returns `null` if *any* of them is missing, so a missing
`dust.json` discards `shielded.json` and `unshielded.json` too. They do not "stay cheap".
Budget the full three-role sync, which is the longer end of the range below, not the
dust-only figure.

This is also why the faucet path is cheaper than this runbook: a fresh seed has no snapshots
at all, so it pays the same three-role sync once, but it needs no dust replay at all because
it owns no prior DUST to recover.

### Bounding the run

The **125-minute figure applies only to a wallet that must replay dust events from genesis**
(the lane's own comment at `packages/integration/src/preprod-lane.mjs:940`, citing
servicedesk #104; the file header also records an operator note that a fresh sync "can
approach three hours"). It is not the cost of every Preprod run.

A **fresh wallet does not pay it.** Measured on 2026-10-22 against a newly generated wallet
with no snapshots: the collapsed-update seed completed in **7,294 ms** (`dust-seed-complete`,
`tailEventsApplied: 0`, cutoff 1711225, height 3094888) and the run emitted `dust-seeded`,
not `dust-seed-failed`. The fast path is available because a fresh wallet's NIGHT arrives at
a future dust event id, always past the seed cutoff, so the tail replay covers it.

That is the whole reason the refusal is scoped to wallets that already registered NIGHT
(`walletHasRegisteredNight`). Only those have DUST UTXOs that predate the cutoff and can
never be recovered.

Budget 2-3 hours only for the from-genesis case, and do not run it unattended without the
receipt trail below.

`MILO_AWAIT_TIMEOUT_MS` is the only deadline that applies here. `awaitSync` calls
`resolveAwaitTimeoutMs(process.env)` and races `wallet.waitForSyncedState()` against it. The
default is **600000 ms (10 minutes)**, which is far shorter than a genesis replay and will
abort the run with `AwaitStallError` long before it finishes. Set it explicitly:

- `MILO_AWAIT_TIMEOUT_MS=10800000` — 3 hours, the recommended bound for a genesis replay.
- `MILO_AWAIT_TIMEOUT_MS=0` — disables the deadline entirely. Only for an attended run;
  a dropped subscription then hangs forever with no error.
- The value is clamped to `1000..86400000`; a blank value keeps the 10-minute default.

`MILO_LOCAL_TIMEOUT_MS` does **not** apply. It is read by `localConfig` in
`packages/integration/src/config.mjs`, which requires `MILO_LOCAL_NETWORK_ID=undeployed` and
a local genesis hash; `preprod-lane.mjs` never calls it. Setting it for a Preprod run has no
effect.

Progress is durable, not just stdout. `awaitSync` appends a `sync-progress-receipt` line to
`<runDir>/transactions.jsonl` every `MIDNIGHT_PREPROD_PROGRESS_INTERVAL_MS` (default 60000,
bounded 10000..3600000) and one immediately at start. Each line carries the applied index of
all three roles plus `elapsedMs`. Watch forward motion with:

```sh
tail -f .hoplite/artifacts/preprod/transactions.jsonl | grep sync-progress-receipt
```

A run also writes `<runDir>/sync-inflight.json` at start and removes it on a clean exit. A
leftover marker means the previous run was interrupted; the next run reports
`previous-run-interrupted`. These files are visibility only: the ledger exposes no
partial-sync checkpoint, so a killed sync is not resumed and its state cannot be
reconstructed from them.

The marker is written by every mode, including a short read-only `--check`, so any run that
is killed or times out leaves one behind and the next run reports a spurious interruption.
Check for it before starting a long replay and remove it only if you know the recorded `pid`
is gone:

```sh
cat .hoplite/artifacts/preprod/sync-inflight.json   # note "mode" and "pid"
rm .hoplite/artifacts/preprod/sync-inflight.json    # only after confirming that pid is dead
```

### Verifying success

**Measured end to end on 2026-10-22 with a fresh seed, so this is the cheap path, not a
replay.** A newly generated wallet, faucet-funded and registered:

| Step | Result |
|---|---|
| Faucet | 5,000 tNIGHT per request; the wallet received 25,000 then 30,000 across requests |
| Dust seed (fast path) | `dust-seeded` in **7,294 ms**, `tailEventsApplied: 0`, cutoff 1711225 |
| `--register-dust` | `dust-registration-estimate` fee **1 speck**; the lane recorded `txId 00f7b0fc…` |
| On-chain confirmation | `unshieldedTransactions` shows the new NIGHT UTXOs with `registeredForDustGeneration: true` at heights 3095117 and 3095156 |
| `--check` after registration | `night: 30000000000`, `dust: 91019669999999999` (**91.02 DUST**) |
| Decoded dust snapshot | `appliedIndex: 1711410`, **`utxos.length: 2`**, `walletBalance: 94987829999999999` |

The `utxos.length: 2` is the load-bearing number. It is the same field that reads `0` on a
wallet seeded past its own history, and the reason the refusal is scoped rather than
blanket: a fresh wallet reaches a non-empty set through the ordinary tail replay.

The on-chain confirmation is the `registeredForDustGeneration: true` flag on the newly
created NIGHT UTXOs, read back from the indexer. The lane's `txId` field is not a queryable
indexer transaction hash (passing it to `transactions(offset: {hash: …})` returns
`invalid transaction hash`), so do not cite it as on-chain proof.

Note the registration fee was **1 speck**, not the 0.3 DUST `additionalFeeOverhead` figure:
the overhead is a fee *margin* the wallet adds, not the fee itself.

1. The run exits cleanly and `sync-inflight.json` is gone.
2. `--check` reports a non-zero dust balance:

   ```sh
   MILO_AWAIT_TIMEOUT_MS=10800000 \
     node --env-file=.env.preprod packages/integration/src/preprod-lane.mjs --check
   ```

   The `preprod-check` receipt carries `balances.dust` and `balances.night`. Success is
   `dust > 0`. Note `--check` bounds its own balance wait at 120000 ms
   (`balances(session, ledger, timeoutMs = 120_000)`), so it is only meaningful after a
   completed sync, when the wallet restores from the snapshot instead of replaying.

3. `walletBalance(now) > 0` and `state.utxos.length > 0`. The UTXO set is the decisive
   signal: a collapsed-update seed restores matching Merkle roots but an empty `utxos`
   array, which is exactly the failure this replay fixes. The seeder's own guard uses the
   same condition (`restored.state.utxos.length === 0` throws `DustSeedError`).

4. The 7 expected `DustInitialUtxo` events at dust ledger ids **1539297-1540159** are the
   events that must have been replayed. Confirm they are present in the range the wallet
   consumed by checking the applied index in the final receipt is at or past 1540159, and
   that the wallet reports 7 spendable dust UTXOs matching the 7 registered NIGHT coins.

   The ids are the operator's recorded values. An independent read-only confirmation of the
   exact range was not completed: sampling Preprod found `DustSpendProcessed` id 1708291 at
   height 3090696 (matching the seeder's recorded cutoff of 1708291 exactly), and id 1541241
   at height 2638005, so the cited range falls in the blocks just below 2638005. Treat the
   precise ids as recorded-but-unconfirmed and verify them against the wallet's own applied
   index rather than relying on them.

### If it fails

| Symptom | Meaning | Action |
|---|---|---|
| `AwaitStallError ... exceeded N ms with no sync` | deadline too short for a genesis replay | raise `MILO_AWAIT_TIMEOUT_MS` (up to 86400000) and rerun |
| `dust-seed-failed` / `dust-seed-fallback` in the trail | the collapsed-update seeder was attempted and refused, which is expected here | confirm `dust.json` was moved aside; the run should fall through to the full sync |
| process killed, `sync-inflight.json` left behind | interrupted run; no checkpoint exists | rerun `--sync`; it restarts from its cursor, it does not resume |
| `wallet-state-rejected` with `sdk-versions-*` | snapshot written under a different SDK matrix | do not auto-repair; run `--repair-state` deliberately, or move the snapshots aside |
| run completes but `dustBalance` still `0` | the replay did not rebuild `utxos` | stop; do not submit anything. Capture the final receipt and the `--check` balances |

**Re-registering the existing NIGHT cannot substitute for this.** `--register-dust` spends
NIGHT to create DUST generation, and that transaction needs a DUST fee the wallet cannot
construct while `dustBalance` is 0. The trail already records this dead end:
`dust-already-registered` with `coins: 7, dustBalance: "0"` and repeated
`dust-force-respend` attempts. Registration is not a workaround for an empty UTXO set; it is
blocked by the same missing DUST.

Do not submit any transaction while `dustBalance` is 0: the proof server will prove a
transaction the node rejects for fee, which burns time and produces no receipt.
