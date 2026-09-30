# R9 — 14-circuit call table (instance | scenario | circuit | tx | block)

Date: 2026-09-30T15:10Z
Agent: A (wt/R6-D2c)
Evidence IDs: `obs_r9_circuit_call_table_1`, `obs_d2a_local_happy_complete_1`, `obs_d2c_preprod_sweep_1`

Scope note (R2 M2 correction): two local happy-path instances exercise **4** circuits each
(reserve → accept → submitDelivery → approve). The remaining **10** circuits are *installed*
on those instances but not *called*. Historical Preprod (2026-09-20) drove all 14; per-circuit
tx hashes are not in the tracked tree (run receipts were gitignored).

---

## 1. Local instance `e1044818…404abe` (undeployed, happy path)

Network: local disposable `undeployed` · genesis `0xe72f7a21…f08b9846`  
Scenario: `happy-path` (reserve → accept → submitDelivery → approve)  
Artifact set: `13bc8bf4ee518fa678b3f4adccdedbd05e1120473ce79594c8dbb2b4c840a944`

| # | instance | scenario | circuit | txId | txHash | block | status |
|---:|---|---|---|---|---|---:|---|
| 1 | `e1044818…` | happy-path | `reserve` | `006a585a…a2b284` | `b139bd7a500abd9d3534dc04e164da3f00d79fa823d90e31d83515bbf3de709d` | 2965 | SucceedEntirely |
| 2 | `e1044818…` | happy-path | `accept` | `00df2d32…9c853e8` | `f213cd84a3a8f80f10a2b09e2509c2d732fdae61c60cc2b2e66f392cc9a98624` | 2969 | SucceedEntirely |
| 3 | `e1044818…` | happy-path | `submitDelivery` | `003886c7…5d893b4` | `db1b8aea91dbed1913b85233aec306c2334804e9293f1d29f41c22f56c77aaea` | 2972 | SucceedEntirely |
| 4 | `e1044818…` | happy-path | `approve` | `0074f39e…730ab15` | `69032e033d815b6fdd708020c1e580a852090154ca1a7014a83d022623b96c4d` | 2976 | SucceedEntirely |

Deploy (staged 7+7): `txHash 152742ebfecb09662b3b283f3dbdefb68737dff59fad918e16e8de18a524b3e4` block 2958  
Insert remaining 7 keys: `txHash b6a942e62b13c669dbea035af3e8572103c12ce26ec1a5040a84b58a457dd295` block 2961

## 2. Local instance `d11a1c39…8526bd7` (undeployed, happy path)

| # | instance | scenario | circuit | txId | txHash | block | status |
|---:|---|---|---|---|---|---:|---|
| 1 | `d11a1c39…` | happy-path | `reserve` | `00350770…99c531b` | `08eaeb696fc98687a8de4c541528318823a8a85ae2197cebdc2ba3f0bf8d4f15` | 2710 | SucceedEntirely |
| 2 | `d11a1c39…` | happy-path | `accept` | `009dbe2c…0a786584` | `0949d73a3b99b48a02103b4f7d4ecceea6a91033e9cb043a5963024e35699d5c` | 2714 | SucceedEntirely |
| 3 | `d11a1c39…` | happy-path | `submitDelivery` | `00ffb3b1…c5f8063d1` | `9d99acbd20762bd0c201cb7679265eda0f609070d12e6b954d4dfd434cb9f716` | 2718 | SucceedEntirely |
| 4 | `d11a1c39…` | happy-path | `approve` | `00d67e01…ebd6f811d50` | `d0893ba31bf6811ea490357718d44bbc1688bd48ab17be9c72aecce2b2b888bf` | 2722 | SucceedEntirely |

## 3. Per-circuit coverage matrix (14 proof circuits)

| circuit | local e104… | local d11a… | Preprod b95c… (2026-09-20) | Preprod D2c (this session) |
|---|:---:|:---:|:---:|:---:|
| `reserve` | CALL 2965 | CALL 2710 | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `accept` | CALL 2969 | CALL 2714 | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `submitDelivery` | CALL 2972 | CALL 2718 | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `approve` | CALL 2976 | CALL 2722 | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `cancelReserved` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `decline` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `disputeBuyer` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `disputeMerchant` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `resolve` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `expireBootstrap` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `expireReserved` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `expireUndelivered` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `expireDispute` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |
| `escalateUnreviewed` | installed only | installed only | DRIVEN 2638272–2639589 | NOT LANDED (DUST) |

**Called this session (local): 4/14 · Installed: 14/14 · Preprod new calls: 0/14**

## 4. Preprod historical (2026-09-20, contract `b95c8243…e74586`)

| fact | value | status |
|---|---|---|
| Deploy (7 keys) | tx `0xd10923d24e70eb9c2e928f4cd18fd689822c85568d59b7ad3aa3af86222ab472` block **2636672** | CHANGELOG (historical) |
| Insert (7 keys) | tx `0x8a6aed776b9ef01bc141da7414f008d56b64de47289e4bfce5bab7b2d52a8939` block **2636676** | CHANGELOG (historical) |
| Order-circuit calls | blocks **2638272–2639589**, all 14 driven | CHANGELOG (historical) |
| Maintenance | `removeVerifierKey` 2639606, `insertVerifierKey` 2639612, `replaceAuthority` 2639638 | CHANGELOG (historical) |
| Per-circuit tx hashes | **not in tracked tree** (run receipts gitignored) | NOT RE-DERIVABLE here |
| State names read-back | 14/14 circuit names present | VERIFIED-ONCHAIN (RECEIPTS.md) |

## 5. Preprod D2c this session (2026-09-30)

| fact | value | status |
|---|---|---|
| fee-math eraseProofs | installed in preprod-lane | DONE |
| wallet-state restore | 16/16 PASS | DONE |
| staged deploy | `Wallet.InsufficientFunds: could not balance dust` | **NOT LANDED** |
| happy-path calls | none | **NOT LANDED** |
| Evidence | `obs_d2c_preprod_dust_blocker_1`, `audit/discovery/D2c-preprod-fee-math-attempt.md` | recorded |

## Signature

Table digest (sha256 of this file content at write time) is recorded in
`audit/discovery/G3-circuit-keys.json` sibling evidence; recompute with
`sha256sum audit/discovery/R9-circuit-call-table.md`.

## NOT DONE

1. Per-circuit Preprod tx hashes for the 2026-09-20 run (receipts gitignored; would need a new consented run or explorer scrape).
2. Local calls for the remaining 10 circuits (need negative/timeout scenarios, not happy-path).
3. Preprod D2c landing (DUST fee blocker — see D2c-preprod-fee-math-attempt.md).
4. M2 remains unchecked: 2 happy-path instances ≠ 14 circuits *across instances* with call hashes.
