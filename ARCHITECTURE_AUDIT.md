# Milo architecture & readiness report

Date: 2026-02-20  
Sources: 5 parallel audits (blueprint/roadmap · UI/UX · backend/Midnight · wallet · contract deploy)

---

## Executive verdict

| Question | Answer |
|---|---|
| Architecture coherent? | **Partially** — intent is clear; package/Convex tree drifts from blueprint |
| Wallet ready for users? | **No** — connect-only; all order/pay actions are simulation |
| Contract deployed? | **NOT on preprod/mainnet** — compile artifacts only + local undeployed stub |
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
| Browser adapter ↔ workspace | UI → `prototype.ts` simulator |
| 8 product packages | `integration` is Node CLI harness |

---

## 2. Roadmap state

| Band | Status | Notes |
|---|---|---|
| R0 / M-08–10 synthetic UI | **Done (bounded)** | Honest sample banners |
| R1 / M-01–03 contract | **Partial** | Compiled 14 circuits; no live `reserve` |
| R2 / M-04–07 product chain+pay | **Missing** | No browser Midnight client, files, Stripe Checkout |
| R3 / M-09–11 QA | **Missing** | axe-core only |
| M-12–14 film/3D | **Deferred** | Per PROGRESS_MANIFEST |

MID coverage: **0/6 providers, 0/14 operations live**.

---

## 3. UI/UX vs design

**Present:** full public+workspace route map, honesty labels, 21 pack photos (600×720) + studio/avatars/CTA, a11y skip/focus basics.

**Specified but missing:**
- Landing modal-over-demo
- Real Privy OTP + quote resume
- Recovery-kit create/verify
- Merchant 3-slot upload + immutable submit
- Evidence privacy split / private receipt
- `/m/:merchantSlug` generic
- `/pilot` enquiry form

**Unspecified extras:** `/connections` diagnostics, prototype toolbar, scenario deep-links.

**Top UX gaps:** sign-in resume · demo modal · recovery kit · evidence/receipt privacy · merchant delivery upload.

---

## 4. Backend & Midnight core

| Area | Real | Stub / missing |
|---|---|---|
| Contract | `order.compact` + `generated/` (14 circuits) | No app circuit-call path |
| Auth | Privy JWT plumbing | Hosted JWKS not proven |
| Admission | Convex admission/canonical/policy | Observer ingest not wired |
| Payments | Stripe test create/observe | No webhooks, capture/void, `reconciliation.ts` |
| Files | `delivery-policy.ts` only | No storage/stream |
| Chain harness | `packages/integration` local deploy/maintain | Network pinned `undeployed` |
| UI domain | — | `prototype.ts` simulator |

**Fail-closed (good):** membership+identity, provisioning revoke, payment windows, observation invalidation, actor-local secrets, PREPROD-only browser, Stripe never auto-captures.

**Fail-open risk:** UI can simulate transitions circuits should own.

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
| Submit / accept / approve / dispute | **Stub** (`workspace/model.tsx` simulation) |
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
| Local | Staged 7+7+lock OK on disposable `undeployed` net |
| **Preprod** | **NOT DEPLOYED** — disposition DEFERRED; `deploymentVerified: false`; no address |
| **Mainnet** | **NOT DEPLOYED / not claimable** |

Full 14-key deploy hits RPC 1010 `ExhaustsResources`; staged path required.

**To deploy:** tNIGHT + DUST registration → staged 7+7 preprod deploy → persist receipt/explorer proof → lift `undeployed` guards → bind address → live circuit calls.

**Do not claim “deployed”** — compile ≠ deploy; local address is not public.

---

## 7. Remaining work (priority)

1. **Preprod staged deploy** + durable address binding  
2. **Browser wallet path** (Lace balance/submit/prove) for real order ops  
3. **Replace `prototype.ts`** transitions with contract-backed client  
4. **Privy → Convex membership + private delivery files**  
5. **Stripe lifecycle** (webhooks, capture-after-APPROVED, reconciliation)  
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
