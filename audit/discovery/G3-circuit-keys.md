# G3-circuit-keys — independent 14 verifier-key table (R6)

**Status**: SIGNED
**Date**: 2026-09-30T13:47:29Z
**Agent**: A (wt/R6-D2c) — independent re-derivation, not copied from prior subagent reports
**Method**: SHA-256 of each `keys/<circuit>.verifier` from `packages/contract/generated/`,
compared to `compile-receipt.json` artifact hashes; cross-checked against
`compiler/contract-info.json` proof-circuit set and the compiled contract cohort
(`NodeZkConfigProvider` / `artifacts.mjs` `proofCircuits`).

## Identity

| Item | Value |
|---|---|
| sourceSha256 (order.compact, from receipt) | `0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0` |
| compile-receipt.json sha256 (independent) | `dc2aca17c60549745bced5c4bfffed4232439e85a3726f25f77cb64421b5c422` |
| contract-info.json sha256 (independent) | `2877e9d9a2c9d178c7223a22ab2bbd0e339d718479b9e8113bbcc877dee08694` |
| compiler / language / runtime | 0.31.1 / 0.23.0 / 0.16.0 |
| proof circuits (receipt) | 14 / 14 |
| proof circuits (contract-info) | 14 / 14 match=True |
| ledger-v8 cohort | 8.1.2 |
| mismatch count | 0 |

## 14 verifier keys

| # | circuit | artifact | bytes | sha256(file) | sha256(compile-receipt) | match | file[:16] |
|---:|---|---|---:|---|---|:---:|---|
| 1 | `accept` | `keys/accept.verifier` | 2119 | `cf48198b6a6594b01e7a806e842c66b6913445ec824cf8b0be3e5d5a1d375708` | `cf48198b6a6594b01e7a806e842c66b6913445ec824cf8b0be3e5d5a1d375708` | YES | `cf48198b6a6594b0` |
| 2 | `approve` | `keys/approve.verifier` | 2119 | `c30ba9a53cc5cf982ae83a4b7727d50028f4da0da5b2459cd352674f2326abda` | `c30ba9a53cc5cf982ae83a4b7727d50028f4da0da5b2459cd352674f2326abda` | YES | `c30ba9a53cc5cf98` |
| 3 | `cancelReserved` | `keys/cancelReserved.verifier` | 2119 | `9d2b0115dee42d105aac084978b839201e88d60fc14baf787e216ba99fd73548` | `9d2b0115dee42d105aac084978b839201e88d60fc14baf787e216ba99fd73548` | YES | `9d2b0115dee42d10` |
| 4 | `decline` | `keys/decline.verifier` | 2119 | `c6805f27484e6944c653e5c12cc0a6617a6309a287bd7eefd39604c1a7ba4694` | `c6805f27484e6944c653e5c12cc0a6617a6309a287bd7eefd39604c1a7ba4694` | YES | `c6805f27484e6944` |
| 5 | `disputeBuyer` | `keys/disputeBuyer.verifier` | 2119 | `19cc84173c86b672aec5a1cd6cf10c2dea4ef347b1c180786c0eaeada9c0e9a1` | `19cc84173c86b672aec5a1cd6cf10c2dea4ef347b1c180786c0eaeada9c0e9a1` | YES | `19cc84173c86b672` |
| 6 | `disputeMerchant` | `keys/disputeMerchant.verifier` | 2119 | `3e187aad50e80a893645665785d0406352aaa7773b7a66160a2e344964c8d58f` | `3e187aad50e80a893645665785d0406352aaa7773b7a66160a2e344964c8d58f` | YES | `3e187aad50e80a89` |
| 7 | `escalateUnreviewed` | `keys/escalateUnreviewed.verifier` | 1351 | `0f0c89ab8e42d700d925b2b56c3ec41d3519cb40f8fff4f118d18d0f8b51e1e7` | `0f0c89ab8e42d700d925b2b56c3ec41d3519cb40f8fff4f118d18d0f8b51e1e7` | YES | `0f0c89ab8e42d700` |
| 8 | `expireBootstrap` | `keys/expireBootstrap.verifier` | 1351 | `0961083d1455d4aabfd40bd153a57ba5c89629738c80cc715124edaf42a2a95c` | `0961083d1455d4aabfd40bd153a57ba5c89629738c80cc715124edaf42a2a95c` | YES | `0961083d1455d4aa` |
| 9 | `expireDispute` | `keys/expireDispute.verifier` | 1351 | `0397e6b3c01a1b19673a53c34f40816f289aa73bea2e9077ff12d1efddfaaba3` | `0397e6b3c01a1b19673a53c34f40816f289aa73bea2e9077ff12d1efddfaaba3` | YES | `0397e6b3c01a1b19` |
| 10 | `expireReserved` | `keys/expireReserved.verifier` | 1351 | `d35b9aa0b59a3b32138850da9484154942d6ee908525f8355433d888337bdc84` | `d35b9aa0b59a3b32138850da9484154942d6ee908525f8355433d888337bdc84` | YES | `d35b9aa0b59a3b32` |
| 11 | `expireUndelivered` | `keys/expireUndelivered.verifier` | 1351 | `666754cbe763ef1955cc1e3a4087d64378cf0705f48f039dfde58c1096ffc7ea` | `666754cbe763ef1955cc1e3a4087d64378cf0705f48f039dfde58c1096ffc7ea` | YES | `666754cbe763ef19` |
| 12 | `reserve` | `keys/reserve.verifier` | 2119 | `91756320470f6ea73fe6ba3eb164a0fc77b02104c1104a8873ae824bc2713fd0` | `91756320470f6ea73fe6ba3eb164a0fc77b02104c1104a8873ae824bc2713fd0` | YES | `91756320470f6ea7` |
| 13 | `resolve` | `keys/resolve.verifier` | 2119 | `5cbc84aa45bbdc8de756ef6f9e60f876ae62d8d0f44b17c9261a3625f003336b` | `5cbc84aa45bbdc8de756ef6f9e60f876ae62d8d0f44b17c9261a3625f003336b` | YES | `5cbc84aa45bbdc8d` |
| 14 | `submitDelivery` | `keys/submitDelivery.verifier` | 2119 | `cedebfff8db6c6dc0a005b68ef87baca8d2f5614ffc7618b80dfc321a5c736c0` | `cedebfff8db6c6dc0a005b68ef87baca8d2f5614ffc7618b80dfc321a5c736c0` | YES | `cedebfff8db6c6dc` |

## Signature

Table content digest (sha256 of canonical table source):

```
fd05fe68ad2a1f000f1cd714d1774c2569209eeb68f8b0c183d0676830e18c7b
```

Sign method: **shasum of table file content** (no HMAC secret involved).
Verify with: `python3 evidence/scripts/obs_r6_g3_circuit_keys_1.mjs` (or recompute
SHA-256 over the `sig_src` fields above).

## Cross-checks performed

1. Each on-disk `keys/<name>.verifier` SHA-256 == `compile-receipt.json` `artifacts[rel]` → **14/14**
2. `compile-receipt.proofCircuits` set == `contract-info` proof circuit names → **True**
3. Set matches `packages/integration/src/artifacts.mjs` `proofCircuits` (14 names) → **YES**
4. Non-empty verifier files (size > 0) → **YES**
5. Source SHA-256 independently recomputed vs receipt (if `src/order.compact` present)

## NOT overwritten

Prior subagent reports in `audit/discovery/` are untouched. This file is a new
independent table (R6). Existing `R8-feesWithMargin.md` / `R5-*.md` remain as-is.
