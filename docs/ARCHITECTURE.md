# Architecture

Milo runs one fixed-price order between a buyer and a studio. Terms stay off-chain. The chain holds the order phase, the revision and commitments. The card is authorized when the order is accepted and captured when the buyer approves.

Status: test mode (Stripe) and Midnight Preprod only. No real money has moved.

## Layers

| Layer | Path | Job |
|---|---|---|
| Web app | `apps/web/` | Landing, sign-in, quotes, orders, account, terms and privacy. React 19, react-router, Tailwind 4, shadcn. |
| Chain module | `apps/web/src/chain/` | Lace connector, two-transaction deploy, order calls, state subscription, wasm loading. Loaded only by dynamic import. |
| Backend | `convex/`, `packages/backend/` | Orders, invites, payment state, webhooks, access rules, email. Convex plus Better Auth. |
| Contract | `packages/contract/` | 14-circuit Compact contract: phase, deadlines, dispute and resolution. |
| Midnight client | `packages/midnight-client/` | Providers, typed errors, network guard. |
| Integration | `packages/integration/` | Preprod preflight and drivers. |
| Hosting | `apps/web/public/vercel.json` | Static site, headers, redirects, CSP (report-only). |

## Trust boundaries

1. Browser to Convex: every public function checks the caller (`convex/admissionContext.ts`). A test covers every public function against six kinds of user (`packages/backend/test/auth-inventory.test.ts`).
2. Stripe to Convex: the webhook verifies the signature, stores the event once, then reconciles.
3. Browser to Lace: the wallet signs and proves. Role secrets stay in the browser, encrypted with a non-extractable key.
4. Browser to Midnight: the wallet supplies the indexer and node endpoints at run time.

## Order timeline

Four windows, each counted from the previous step: 1 hour to accept, 24 hours to deliver, 48 hours to review, 48 hours to resolve a dispute. Together they are 121 hours, inside the 7-day card authorization window. The values live in `packages/backend/src/order-windows.ts`.

## Out of scope

Live Stripe mode, Stripe Connect and merchant payout, and a separate production Convex deployment are not built: the live site runs on the dev deployment in test mode. Milo is not an escrow service.

## Decisions

See `docs/adr/`.
