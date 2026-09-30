# PITCH.md

Milo — private commissioning workspace. D7 pitch artifact.  
Claims discipline: every factual assertion is linked to a primary source in `audit/discovery/RESEARCH-LOG.md` or to `RECEIPTS.md`. No invented statistics. No customer traction. No live-payment claims.

## One-liner

**Agree the scope privately. Know exactly what was approved.**  
Milo is a one-buyer, one-merchant, fixed-price three-image commissioning workspace. Midnight Compact enforces the order lifecycle on a public ledger. Price, brief, and files stay off-chain.

## One buyer persona

**Role.** Launch operations lead at a small e-commerce brand (UC-01: brand ↔ product photographer).  
**Job.** Commission three launch-ready product photos before a confidential SKU drop.  
**Pain.** Quote in email, brief in a shared folder, approval in chat, payment elsewhere — and later a dispute about which files and which price were accepted.  
**Must-have before authorizing.** Price, scope, recipient, deadline, and consequences visible up front; a clear approval record after delivery; no public listing of pre-launch pricing or creative.  
**Not claimed.** This persona is a wedge hypothesis from `01-blueprint.md` §1.1 / UC-01. It is not observed demand, a signed pilot, or a revenue figure.

## One studio GTM step

**Step.** Recruit one design-partner studio (independent product photographer) already selling three-image packs, and run invite-only order links to that studio’s existing buyers — no marketplace, no discovery product.  
**Success measure for the step.** Number of complete orders that reach an approval or cancellation record; independent re-query of phase + deliveryCommitment; support minutes per order.  
**Not claimed.** No design partner is signed. No pilot is scheduled. This is the single distribution experiment from `02-roadmap.md` Wave-2 distribution workstream and the “one studio GTM step” required for D7.

## One measurable ROI claim

**Claim.** For each closed three-image deal, Milo aims to replace a private chat/email archive with a **public, re-queryable lifecycle record**: order phase and delivery commitment, without publishing price or brief.  
**How to measure (pilot protocol).**  
1. Give an independent reviewer only the contract address and a public Midnight Preprod indexer. Pass if they can retrieve current phase and the delivery commitment fields, and confirm the named circuits cover `submitDelivery` and `approve`.  
2. Time the same reviewer assembling equivalent evidence from a traditional thread (exports + invoices). Record minutes for both paths.  
**What is evidenced today.** The re-query path is demonstrated for contract state on Preprod: contract address, latest state transaction, block height, and all 14 circuit names (including `submitDelivery`, `approve`) are verified on-chain in `RECEIPTS.md`.  
**What is not claimed.** No time-savings number, cost-savings number, conversion lift, or customer ROI percentage is asserted. Those are pilot outcomes to measure, not current facts.

## Why Midnight (bounded)

| Need | Mechanism | Evidence |
|---|---|---|
| Lifecycle integrity visible to both parties | Public order phase and commitments on Preprod | `RECEIPTS.md` (state + circuit names) |
| Commercial terms not on the public ledger | Terms/brief/files stay off-chain; ledger holds phase + hashed commitments | Product design `01-blueprint.md` §1.1; contract address in `RECEIPTS.md` |
| Independent rule checks | Compact circuits for reserve → approve → cancel → dispute paths | 14 named circuits in contract state (`RECEIPTS.md`) |
| Separation of approval and payment | Approval is a chain lifecycle fact; card capture is external | Stripe test-mode endpoint configured; PaymentIntents/capture **not yet** (`RECEIPTS.md`) |

Primary documentation anchors are logged in `audit/discovery/RESEARCH-LOG.md` (Midnight docs, Preprod indexer GraphQL, explorer contract page).

## Honest readiness (dual-state)

| Plane | Status | Source |
|---|---|---|
| Execution on Preprod | 14 / 14 circuits exercised | `RECEIPTS.md` |
| Provider acceptance | 0 / 6 | `RECEIPTS.md` |
| Operation acceptance | 0 / 14 | `RECEIPTS.md` |
| Stripe capture / PaymentIntents | Not yet | `RECEIPTS.md` |
| Wallet-signed reserve/accept end-to-end | Not claimed in this pitch | D2 / later demos |

This pitch does **not** claim a complete customer deal, production readiness, live payments, or organizer acceptance.

## Deck and script

| Artifact | Path |
|---|---|
| 10-slide SVG deck | `pitch/deck/slide-01.svg` … `slide-10.svg` |
| Merged PDF | `pitch/deck/milo-d7-deck.pdf` |
| 90s video script (standalone; no `demo/` source tree) | `pitch/VIDEO-SCRIPT-90S.md` |
| Submission text + per-sentence claims-check | `SUBMISSION-UPDATE.md` |

## Source index

All external primary sources used by this pitch are recorded with URL, date, and result in `audit/discovery/RESEARCH-LOG.md`. On-chain facts used here are limited to `RECEIPTS.md` rows marked `VERIFIED-ONCHAIN` or explicitly labeled incomplete (acceptance, Stripe capture).


## Evidence refresh 2026-09-30

- Local happy path 4/4 SucceedEntirely (obs_d2a_local_happy_complete_1)
- M2 14/14 circuits across 10 instances (obs_m2_circuit_sweep_1)
- M3 chain-layer 3× matrix (obs_m3_matrix_1)
- Canonical contract 0bede3fb keys 14/14 signed (obs_r6_g3_circuit_keys_1)
- Axe 16 routes 0 serious (obs_pr7_axe_all_routes_1)
