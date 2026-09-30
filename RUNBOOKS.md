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

## PR3/PR4 addendum (Reliability + Chain ops)

Full report with evidence IDs: ../audit/discovery/IMPLEMENTATION-P2-PR3PR4.md

### Reliability ops
- Idempotency keys: settlement milo-ACTION:orderId:contractRevision; inbox provider|accountId|eventId. Never mint a new key for a retry of the same business action.
- Retries: generation+attempt fences; lease 60s; sweep reclaims stale running as pending with attempt+1 (generation preserved).
- Sweeps (manual until crons registered): npx convex run settlement:sweep; grant sweep files.sweepGrantsMutation.
- Dead letters: settlementOps state reconciliation (ambiguous) or blocked + lastReason. Inspect with settlement:opsForPaymentIntent. Webhook reconcile requeues reconciliation to pending. Do not blind-retry blocked.
- Backup/restore drill (dev): export Convex data, scratch restore, verify inbox dedupe. NOT DONE (no artifact).
- Rollback: prior dist/ plus npx convex deploy previous SHA; re-verify webhook HMAC.

### Chain ops
- Operator keys: .env.preprod mode 600, gitignored; seed never printed (spend-balance.mjs redact). Disclosed seed means burn wallet, never fund on mainnet.
- DUST: bun scripts/spend-balance.mjs --audit|--wallet|--local; log spends in SPEND-LEDGER.md; dust-seed is read-only and fail-closed.
- Indexer: fixed Preprod GraphQL; errors/lag/disagreement fail closed (scripts/preprod-observe.mjs).
- Network guard: PREPROD only (SUPPORTED_MIDNIGHT_NETWORK); Mainnet blocked until separate authorization.
