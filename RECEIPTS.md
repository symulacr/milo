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
