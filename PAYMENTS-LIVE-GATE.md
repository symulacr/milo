# PAYMENTS-LIVE-GATE.md

Test→live switch procedure. **Gated OFF.**

## Current
- `STRIPE_SECRET_KEY` = `sk_test_` only
- Webhook secret in Convex env
- `stripeSettlement:run` uses test API
- No card data on Milo servers (Stripe Elements / hosted fields never touch us)

## To enable live (OWNER only)
1. Create live Stripe keys in dashboard
2. Set `STRIPE_SECRET_KEY=sk_live_…` in Convex env (server only)
3. Create **live** webhook endpoint → `https://<site>/webhooks/stripe` with `STRIPE_WEBHOOK_SECRET`
4. Flip `STRIPE_LIVE=true` gate in `stripe-observer.server.ts` (currently refuses live)
5. Re-run capture/void tests with live keys in staging
6. Legal review of refund/dispute copy

## Refund / dispute
- Refund: Stripe dashboard or future `settlement:refund` (not implemented)
- Dispute: operator path in contract (`disputeBuyer`/`disputeMerchant`/`resolve`); Stripe dispute is separate and **not automated**

## Never
- Commit live keys
- Run live against Preprod contract
- Claim live payments in UI before step 6
