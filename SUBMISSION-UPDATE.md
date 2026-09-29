# SUBMISSION-UPDATE.md

Paste-ready. Every claim has a receipt.

## Updates in this Wave

```text
Milo. Private commissioning workspace. One buyer. One merchant. One fixed-price three-image deal. Commercial terms stay off-chain. Midnight Compact proves the order lifecycle only. That split is the product. Private price and brief. Public integrity of delivery and approval. No public marketplace leak.

Wave 2 shipped the product kernel and real receipts.

ON-CHAIN (Midnight Preprod, indexer-verified 2026-09-29)
- Contract: b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586
- Latest state tx: 5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58
- State block: 2639638. Chain height at read: 2765910
- Contract state names all 14 order circuits: reserve, accept, submitDelivery, approve, cancelReserved, decline, disputeBuyer, disputeMerchant, resolve, expireBootstrap, expireReserved, expireUndelivered, expireDispute, escalateUnreviewed
- Canonical contract source hash 0bede3fb… (sealed ledger fields). Full receipts in repo: RECEIPTS.md
- Dual-state, both published: execution 14/14. Acceptance 0/14 until provider sign-off.

KERNEL (reconstructed and tested after a local incident)
- Stripe test-mode webhook endpoint we_1UL7TWIDa2vgC4L9PfUE2ZAl → Convex site /webhooks/stripe. HMAC, replay window, body cap, livemode refused. Capture only on APPROVED. Void only on CANCELLED.
- File delivery. Magic-byte inspect PNG/JPEG/WebP under 5MB. Freeze. deliveryCommitment is the hash of ordered file digests. No random placeholders.
- Chain observation ingest. Verdicts bind, replay, stale, contradictory, address-claimed.
- Release gates. immutableOrderAdmission and r1Complete stay false until stored receipts exist.
- packages/midnight-client. Preprod lock. Lace dapp-connector v4. SDK connector. Fail-closed reserve and accept preparation.
- recovery-kit. A buyer cannot recover into a usable order by accident.

MEASURED
- Production build exit 0
- Unit 485 pass / 4 fail / 1 error
- ~57k LOC tracked text. ~42k code LOC

ROI
Private terms for 1:1 commissions where a public listing leaks leverage. Public lifecycle so delivery and approval are auditable. Fits illustration, photography, studio packs.

Repo: https://github.com/symulacr/milo
Receipts: RECEIPTS.md in repo root
Docs: 01-08 design corpus, contract SPEC

Still ongoing. Wallet-signed reserve and accept on local Midnight. Connected Stripe capture with object IDs. Browser E2E. Coverage gate.
```

## Milestone 3rd Wave

```text
Trust kernel plus on-chain receipts. Compact 14-circuit lifecycle live on Preprod. Stripe-aligned settlement. File delivery integrity. Observation ingest. Release flags. Build green. Dual-state metrics published. Uniqueness is private terms plus public lifecycle integrity. Next wave is one signed deal end to end with video.
```

## 4th Wave

```text
One real deal. No shortcuts.
1. Wallet-signed reserve, accept, submitDelivery, approve. SDK connector first. Lace in Chromium second.
2. Connected Stripe capture on APPROVED and void on CANCELLED with pasted object IDs.
3. Order console shows chain-backed phase and checkpoint address. No phase label without a record.
4. Browser E2E video plus negative paths. Cancel, dispute, wrong network, stale revision, forged webhook.
5. Coverage report. Pitch with one buyer persona and one studio GTM step.
```
