# SUBMISSION-UPDATE.md

**Version.** v2 · D7 package  
**Evidence rule.** Every sentence in the paste-ready block has a claims-check row below. The **Evidence** column cites **`RECEIPTS.md` only**. Sentences without a receipt-backed factual claim are marked `DEFINITION` or `UNSUPPORTED` and must not be read as performance, traction, or live-payment claims.  
**Do not** paste v1 kernel/test counts into a form that requires receipts-only evidence (unit 485 and Stripe HMAC results are not in `RECEIPTS.md`).

---

## Paste-ready (v2)

```text
Milo is a private commissioning workspace for one buyer, one merchant, and one fixed-price three-image deal.

The product keeps commercial terms off-chain and exposes order lifecycle integrity on Midnight.

ON-CHAIN (Midnight Preprod; verified via indexer GraphQL 2026-09-29)
- Network: Midnight Preprod.
- Contract address: b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586.
- Latest action type: ContractUpdate.
- Latest tx hash: 5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58.
- Block height (state): 2639638.
- Chain height at read: 2765910.
- Network label in state: preprod.
- Contract state names 14 order circuits: reserve, accept, submitDelivery, approve, cancelReserved, decline, disputeBuyer, disputeMerchant, resolve, expireBootstrap, expireReserved, expireUndelivered, expireDispute, escalateUnreviewed.
- Canonical contract source hash: 0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0.
- Dual-state, both published: execution 14/14. Provider acceptance 0/6. Operation acceptance 0/14.

STRIPE (test-mode)
- Webhook endpoint id: we_1UL7TWIDa2vgC4L9PfUE2ZAl.
- Endpoint URL: https://tremendous-rooster-473.convex.site/webhooks/stripe (configured).
- PaymentIntents / capture: not yet.

CONVEX (dev)
- Cloud: https://tremendous-rooster-473.convex.cloud.
- Site: https://tremendous-rooster-473.convex.site.

PITCH (D7)
- One buyer persona and one studio GTM step are in PITCH.md.
- One measurable ROI claim is defined as pilot metrics (independent re-query pass/fail and minutes-to-evidence). No ROI percentage is claimed.

Full receipts table: RECEIPTS.md. Primary sources for the pitch: audit/discovery/RESEARCH-LOG.md.

Still ongoing: wallet-signed reserve and accept; connected Stripe capture with object IDs; browser E2E; full acceptance rows.
```

---

## Claims-check (one row per sentence)

| # | Sentence | Evidence (RECEIPTS.md only) | Verdict |
|---|---|---|---|
| 1 | Milo is a private commissioning workspace for one buyer, one merchant, and one fixed-price three-image deal. | — (product definition; no RECEIPTS row) | DEFINITION |
| 2 | The product keeps commercial terms off-chain and exposes order lifecycle integrity on Midnight. | Contract state carries phase/circuit names; price/brief are not in the on-chain fact table | DEFINITION + consistent with state contents |
| 3 | Network: Midnight Preprod. | On-chain facts → Network | CONFIRMED |
| 4 | Contract address: b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586. | On-chain facts → Contract address | CONFIRMED |
| 5 | Latest action type: ContractUpdate. | On-chain facts → Latest action type | CONFIRMED |
| 6 | Latest tx hash: 5ce74cb9406e2d9398b0d3c5c949b2d86d5a3068e7b621ca5f0d1b6ee479cd58. | On-chain facts → Latest tx hash | CONFIRMED |
| 7 | Block height (state): 2639638. | On-chain facts → Block height (state) | CONFIRMED |
| 8 | Chain height at read: 2765910. | On-chain facts → Chain height at read | CONFIRMED |
| 9 | Network label in state: preprod. | On-chain facts → Network label in state | CONFIRMED |
| 10 | Contract state names 14 order circuits: reserve, accept, submitDelivery, approve, cancelReserved, decline, disputeBuyer, disputeMerchant, resolve, expireBootstrap, expireReserved, expireUndelivered, expireDispute, escalateUnreviewed. | On-chain facts → Circuit names in state | CONFIRMED |
| 11 | Canonical contract source hash: 0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0. | Contract identity → canonical SHA256 | CONFIRMED |
| 12 | Dual-state, both published: execution 14/14. | Execution vs acceptance → Circuits exercised on Preprod | CONFIRMED |
| 13 | Provider acceptance 0/6. | Execution vs acceptance → Provider acceptance | CONFIRMED |
| 14 | Operation acceptance 0/14. | Execution vs acceptance → Operation acceptance | CONFIRMED |
| 15 | Webhook endpoint id: we_1UL7TWIDa2vgC4L9PfUE2ZAl. | Stripe (test-mode) → Webhook endpoint id | CONFIRMED |
| 16 | Endpoint URL: https://tremendous-rooster-473.convex.site/webhooks/stripe (configured). | Stripe (test-mode) → Endpoint URL | CONFIRMED |
| 17 | PaymentIntents / capture: not yet. | Stripe (test-mode) → PaymentIntents / capture | CONFIRMED |
| 18 | Cloud: https://tremendous-rooster-473.convex.cloud. | Convex dev → URL | CONFIRMED |
| 19 | Site: https://tremendous-rooster-473.convex.site. | Convex dev → Site | CONFIRMED |
| 20 | One buyer persona and one studio GTM step are in PITCH.md. | — (artifact pointer, not a world fact) | ARTIFACT |
| 21 | One measurable ROI claim is defined as pilot metrics (independent re-query pass/fail and minutes-to-evidence). | — (measurement protocol; no ROI number in RECEIPTS) | PROTOCOL (no figure claimed) |
| 22 | No ROI percentage is claimed. | — (absence of claim) | CONFIRMED (negative) |
| 23 | Full receipts table: RECEIPTS.md. | Self-reference | ARTIFACT |
| 24 | Primary sources for the pitch: audit/discovery/RESEARCH-LOG.md. | Self-reference | ARTIFACT |
| 25 | Still ongoing: wallet-signed reserve and accept; connected Stripe capture with object IDs; browser E2E; full acceptance rows. | Stripe capture “not yet”; acceptance 0/6 and 0/14 | CONFIRMED as incomplete |

### Counts (v2)

| Bucket | N |
|---|---:|
| CONFIRMED (receipt-backed fact) | 17 |
| CONFIRMED (explicit negative) | 1 |
| DEFINITION | 2 |
| ARTIFACT | 3 |
| PROTOCOL (no figure) | 1 |
| UNSUPPORTED overclaim | 0 |
| OVERSTATED | 0 |

### Explicit non-claims (must not appear in the form)

- Unit test totals (485/4/1, 582, etc.) — not in `RECEIPTS.md`.
- “Stripe signed webhooks tested”, HMAC, livemode refusal — not in `RECEIPTS.md` as executed results.
- File delivery magic-byte tests, recovery-kit tests, release-flag tests — not in `RECEIPTS.md`.
- Wallet-signed reserve/accept live — unsupported.
- Live Stripe capture object IDs — unsupported (`not yet`).
- Full browser E2E video — unsupported.
- ROI %, time saved, revenue, users, design-partner commitment — unsupported.

### Repo tip

If a form asks for a commit SHA, read the current git tip at submit time. Do not paste a stale SHA from older notes.
