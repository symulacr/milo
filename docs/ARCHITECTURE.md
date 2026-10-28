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

## Operator

An operator resolves disputes across studios. Rights come from the `MILO_OPERATOR_EMAILS` allowlist and nothing else: removing an email removes the access on the next read, and there is no stored operator row to drift from it. `operatorConfig()` in `packages/backend/src/session-identity.ts` is the single source for whether one exists; `diagnostics.read`, the daily digest and `orders.order` all read it.


### What the operator can read

The chain stores `sha256(note.trim())` as `evidenceCommitment`, so the reason a
buyer typed is a commitment, not a message — nothing can read it back from the
chain. Before R40 that meant the operator decided a dispute holding a hash.

The buyer now also seals the note to the operator's **per-order** key and stores
only the ciphertext (`disputeNotes`, one row per order):

- **Where the private key lives.** Nowhere new. It is the existing
  `quoteDrafts.operatorSecret` — the same per-order secret that signs as the
  operator — written once at quote creation, server-only, never in a `returns`
  validator or a public projection.
- **How the operator gets it.** The same `operatorSecret` action that already
  issues the signing capability, after the same `operatorAllowed` check.
- **How the buyer gets the public half.** `orders.order` publishes
  `operatorPublicKey`, derived once at creation by
  `packages/backend/src/note-key.ts` and stored as `quoteDrafts.notePublicKey`. A
  public key reveals nothing about the secret.
- **Rotation.** The secret is per-order and written once, so it cannot rotate
  under a live order; a new order gets a new secret, which is the isolation we
  want. Changing `MILO_OPERATOR_SECRET` affects only pre-R22 orders, exactly as
  it already does for signing — not a new blast radius.
- **What the server can read.** Nothing. Only ciphertext is stored, and the AAD
  is the quote id, so a row copied to another order will not open.
- **How the operator trusts it.** The browser decrypts, recomputes
  `sha256(plain.trim())`, and checks it against both the stored `digest` and the
  chain's `evidenceCommitment`. The panel says so explicitly when they disagree.

**If `MILO_OPERATOR_EMAILS` is unset, no dispute can be resolved and no operator key can be issued.** The deployment says so rather than failing quietly: the digest logs `operator-unconfigured` and `digest-skipped` with the consequence, `diagnostics.read` returns it as `operator.disputes`, and `orders.order` carries the same sentence so the order page warns before a buyer commits a dispute. Opening a dispute still works — the circuit is on the chain — but nothing will resolve it.

## Out of scope

Live Stripe mode, Stripe Connect and merchant payout, and a separate production Convex deployment are not built: the live site runs on the dev deployment in test mode. Milo is not an escrow service.

## Decisions

See `docs/adr/`.
