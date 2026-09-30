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

Full spend table (hash | purpose | fee | block | chain height) lives in [`SPEND-LEDGER.md`](./SPEND-LEDGER.md).
Fee estimates were taken **before** submission. Seed material is never printed; balances via `scripts/spend-balance.mjs`.

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

Full narrative + NOT DONE: [`audit/discovery/IMPLEMENTATION-D2c-preprod.md`](./audit/discovery/IMPLEMENTATION-D2c-preprod.md).