# DESIGN-PARTNER-GUIDE.md

Test-mode only. No live payments.

## Who
Independent photographers / small studios taking 1:1 product-image commissions (3 final images, fixed price).

## Setup (10 min)
1. Invite merchant to Milo pilot (`/pilot`)
2. Connect Convex dev + Stripe **test** keys (see `.env.example`)
3. Create quote in `/orders` (sample data ok)
4. Share order link with buyer
5. Buyer reviews in `/demo` then `/orders`

## Rules
- Never collect card numbers on Milo
- Stripe test-mode only until owner flips live
- Preprod Midnight only; no mainnet
- Terms and briefs stay off-chain
- Dual-state metrics: execution vs acceptance

## Support runbook (short)
| Symptom | Action |
|---|---|
| Wallet not connected | `/connections` — Lace v4 or SDK connector |
| Phase missing | No backing order record (honest) |
| Webhook 503 | Set `STRIPE_WEBHOOK_SECRET` in Convex env |
| Capture stuck | Check settlementOps state; reconcile via `settlement:reconcile` |
| File read denied | Grant expired or not member |

## Escalation
Owner queue: live keys, mainnet, hosting, CI.
