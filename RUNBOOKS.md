# RUNBOOKS.md

## Deploy (test-mode)
1. `bun run build`
2. Host `dist/` (Vercel/Netlify). Env: `PRIVY_APP_ID`, `CONVEX_URL`, `MIDNIGHT_NETWORK=preprod`
3. Convex: `npx convex deploy` with `CONVEX_DEPLOY_KEY`
4. Set Convex env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRIVY_APP_ID`
5. Smoke: `/` `/demo` `/orders` `/connections`

## Rollback
1. Revert host to previous `dist/`
2. `npx convex deploy` previous git SHA
3. Verify webhook still accepts HMAC

## Secret rotation
1. Stripe dashboard → rotate `whsec_`
2. `npx convex env set STRIPE_WEBHOOK_SECRET <new>`
3. Test bad-sig reject + good-sig accept
4. Rotate `sk_test_` similarly

## Incident
1. Disable webhook endpoint in Stripe
2. Set Convex env `STRIPE_WEBHOOK_SECRET=` empty → 503 fail-closed
3. Inspect `paymentInbox` / `settlementOps`
4. Resume after root cause

## Env separation
| Env | Stripe | Midnight | Convex |
|---|---|---|---|
| local | test or none | compose undeployed | convex-local |
| dev | sk_test_ | preprod | tremendous-rooster-473 |
| prod | sk_live_ (owner) | TBD | TBD |

## SBOM
`bun pm ls` + `packages/integration/package-lock.json` (dual lockfiles).
