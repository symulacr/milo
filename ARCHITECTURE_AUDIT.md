# Milo architecture & readiness report

Date: 2026-09-23  
Sources: 5 parallel audits (blueprint/roadmap · UI/UX · backend/Midnight · wallet · contract deploy)

---

**SUPERSEDED (A0-2 tree loss):** paths and modules cited below that lived under convex/, scripts/, packages/{backend,contract,domain,integration}, and packages/midnight-client are **gone from this tree** (see audit/discovery/BASELINE-P3.md). Claims about those modules are historical receipts only and are not re-verified on this tree. Fresh suite counts are UNKNOWN until sources are restored.

## Executive verdict

| Question | Answer |
|---|---|
| Architecture coherent? | **Partially** — intent is clear; package/Convex tree drifts from blueprint |
| Wallet ready for users? | **No** — connect-only; all order/pay actions are simulation |
| Contract deployed? | **Preprod yes, mainnet no** — `0xb95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586`; all 14 circuits exercised, must-reject suite and maintenance drills run |
| Ship as product? | **No** — UI can show success without chain/payment truth |

---

## 1. Architecture (intent)

Private fixed-price creative orders (`image-pack-v1`):

- **Midnight Compact** — transition authority (14 circuits); commercial terms off public ledger
- **Convex** — authorized app records / projections (never signs chain)
- **Privy** — app login only (no order authority)
- **Stripe** — external settlement (manual capture, gated after `APPROVED`)
- **Three planes** — actor-local secrets · public ledger · Convex projections

Optional gated: Lumera Cascade, Browser Use QA, DUST sponsorship.

### Drift (claim → reality)

| Blueprint claim | Reality |
|---|---|
| `packages/{contracts,midnight-client,ui,test-fixtures}` | Only `{backend,contract,domain,integration}` |
| Convex `orders/payments/files/http/crons` | Flat modules; schema is admission/payment-centric |
| Browser adapter ↔ workspace | No browser circuit-call path; read-only order console |
| 8 product packages | `integration` is Node CLI harness |

---

## 2. Roadmap state

| Band | Status | Notes |
|---|---|---|
| R0 / M-08–10 synthetic UI | **Done (bounded)** | Honest sample banners |
| R1 / M-01–03 contract | **Partial** | 14 circuits compiled and exercised on Preprod; no buyer-authorized application `reserve` |
| R2 / M-04–07 product chain+pay | **Missing** | No browser Midnight client, files, Stripe Checkout |
| R3 / M-09–11 QA | **Missing** | axe-core only |
| M-12–14 film/3D | **Deferred** | Per PROGRESS_MANIFEST |

MID coverage: **all 14 operations executed on Preprod (test network, 2026-09-20; execution 14/14); the six provider acceptance rows remain partial (acceptance 0/6 provider / 0/14 operation)**. SUPERSEDED (A0-2): the earlier word live implied product/live-chain readiness; Preprod is a test network and this is not a live service or mainnet deployment.

---

## 3. UI/UX vs design

**Present:** full public+workspace route map, honesty labels, 21 pack photos (600×720) + studio/avatars/CTA, a11y skip/focus basics.

**Specified but missing:**
- Landing modal-over-demo
- Real Privy OTP + quote resume
- Recovery-kit checkpoint (canonical address) only; create/verify are local
- Merchant 3-slot upload + immutable submit
- Evidence privacy split / private receipt
- `/m/:merchantSlug` generic
- `/pilot` enquiry form

**Unspecified extras:** `/connections` diagnostics, scenario deep-links.

**Top UX gaps:** sign-in resume · demo modal · recovery-kit checkpoint · evidence/receipt privacy · merchant delivery upload.

---

## 4. Backend & Midnight core

| Area | Real | Stub / missing |
|---|---|---|
| Contract | `order.compact` + `generated/` (14 circuits) | No app circuit-call path |
| Auth | Privy JWT plumbing | Hosted JWKS not proven |
| Admission | Convex admission/canonical/policy | Observer ingest not wired |
| Payments | Stripe test create/observe | ~~No webhooks, capture/void, `reconciliation.ts`~~ **STALE (doc truth pass):** `convex/http.ts` implements signed webhook ingress (HMAC verify, body cap, account/env fence) and `convex/settlement.ts` owns `recordEvent`/`reconcile`/`request`/`begin`/`finish`/`sweep` (capture/void reducers). There is no separate `reconciliation.ts`. Connected Stripe effects still unverified. |
| Files | `delivery-policy.ts` + `convex/files.ts` + `http.ts` `/files` byte transport | ~~No storage/stream~~ **STALE (doc truth pass):** constrained manifest/freeze/resolveRead and protected byte streaming exist; browser wiring and hosted storage adapters remain open. |
| Chain harness | `packages/integration` staged deploy/maintain | Network pinned `undeployed` for local runs; the same staged path then bound a real Preprod address |
| UI domain | `prototype.ts` vocabulary only | No UI-domain logic |

**Fail-closed (good):** membership+identity, provisioning revoke, payment windows, observation invalidation, actor-local secrets, PREPROD-only browser, Stripe never auto-captures.

---

## 5. Wallet integration — where users need it

| Surface | Status |
|---|---|
| Lace / Midnight connector | Connect + status only (PREPROD, API v4) |
| Privy email | Sign-in only — **no order authority** |
| Stripe | Server test intents — **not a user action** |
| Native Midnight SDK | Real harness, **not browser UX** |

| Journey | Browser today |
|---|---|
| Connect | Partial (diagnostics) |
| Sign | **None** |
| Submit / accept / approve / dispute | **None** - no browser circuit-call path; the simulator was removed, the circuits run from the native lane |
| Pay | **Stub UI** |

### Integration order (recommended)
1. Native Preprod lifecycle + proof/fee measurement  
2. Browser Lace transport (balance, submit, digest consent)  
3. Authenticated tx + submission-authority backends  
4. Stripe confirm UI + quote/customer binding (capture still gated)  
5. Full user-controlled Preprod lifecycle + recovery  

**Constraints:** PREPROD only; mainnet blocked; API `/^4./`; fail closed on config/network/SDK errors.

---

## 6. Contract deploy state

| Layer | State |
|---|---|
| Source | `packages/contract/src/order.compact` (hash-bound) |
| Generated | 14 circuits + keys/zkir + compile-receipt (**not a chain receipt**) |
| Local | Staged 7+7+lock OK on disposable `undeployed` net; the same staged path then run on Preprod |
| **Preprod** | **DEPLOYED** — `0xb95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586`, deployed in block **2636672** (tx `0xd10923d2...ab472`); seven verifier keys in that transaction and seven more by maintenance update in block **2636676** (tx `0x8a6aed77...a8939`), 14 of 14 read back from state; all 14 circuits exercised; maintenance drills then froze authority to `committee: [], threshold: 1, counter: 4` |
| **Mainnet** | **NOT DEPLOYED / not claimable** |

The full 14-key deploy in one transaction still exceeds the per-extrinsic ref-time limit. The fee-paying form finalized locally declares 1,330,680,000,001 (2.37 percent over the 1,299,891,843,000 limit); the Preprod staged path declares the construction-only form at 1,321,480,000,001 (1.66 percent over). The 9,200,000,000 difference is the DUST fee-offer overhead the fee-paying form carries, so these are one deploy measured two ways rather than a disagreement; the staged 7+7 path is what makes it fit.

**Deployed and proven:** tNIGHT funded, DUST registered, staged 7+7 Preprod deploy, all 14 order circuits driven with real txIds between blocks 2638272 and 2639589, must-reject suite rejected at the contract layer, and maintenance drills run; the receipt/explorer evidence is retained outside the tracked tree.

---

## 7. Remaining work (priority)

1. **Durable address binding** of the deployed Preprod contract  
2. **Browser wallet path** (Lace balance/submit/prove) for real order ops  
3. **Wire the read-only console** to a contract-backed browser client  
4. **Privy → Convex membership + private delivery files**  
5. **Stripe lifecycle** — webhook ingress (`http.ts`) and capture/void reducers (`settlement.ts`) exist; remaining work is connect/verify them against test-mode Stripe and wire capture-after-APPROVED 
6. Recovery kit + merchant upload + evidence/receipt UX  
7. Usability/a11y evidence (M-08–11)

---

## 8. Ship risks

- Simulation can look like success without chain/payment truth  
- No live membership/file isolation or recovery  
- Payment incomplete → money/compliance exposure  
- False claims of privacy verification or deployment would be inaccurate  

---

## Agent coverage

| Agent | Scope |
|---|---|
| explore-4 | blueprint + roadmap drift |
| explore-5 | UI/UX design drift |
| explore-6 | backend + Midnight core |
| explore-7 | wallet integration map |
| explore-8 | contract deploy state |
