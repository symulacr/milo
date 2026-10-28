# Provider setup boundary

[Current verification](provider-verification.md) separates local tests and UI
observations from the unexecuted hosted provider gates below.

Implemented preparation, **not a connected deployment**:

- `convex/stripeCustomerProvisioning.ts`: internal-only test-account/customer retrieval before the existing audited customer write. The evidence digest is server-derived, but buyer ownership remains operator-asserted. See [the provider-fact boundary](trusted-provisioning.md#stripe-test-customer-provider-facts-t09b1); no payment effect is available through this action.

- `convex/auth.config.ts`: native ES256 JWT verification, exact `privy.io` issuer, required app audience and app-scoped JWKS. `auth/session:current` returns only the authenticated subject.
- `convex/schema.ts` and `convex/admission.ts`: trusted-input tables and authenticated `admission:bind`. The mutation reads all canonical indexes and awaits its insert in one Convex transaction. See [the admission boundary and native local tests](../packages/backend/ADMISSION.md).
- `convex/provisioning.ts`: authenticated buyer mutations `provisioning:freeze` and `provisioning:requestPayment` freeze an existing approved quote and queue a consented test-payment job from trusted customer bindings. Internal `begin`/`finish` mutations claim generations and persist immutable intent bindings/ordered observations. These are not ingestion APIs for membership, approved catalog/quotes, customers or chain observations.
- `convex/stripeProvisioning.ts`: internal-only Node action `stripeProvisioning:run` creates an unconfirmed manual-capture test intent or refreshes an existing intent's observation. These buyer requests remain one-shot. Separately consented, five-minute read-only monitoring uses `paymentMonitoring:start`/`stop` and `stripeMonitoring:run`; see the [bounded monitoring boundary](payment-monitoring.md).
- `convex/auth/identity.ts`: current active membership lookup by verified subject and scope. Duplicate membership records fail closed. Privy login alone grants no order or Midnight authority.
- `packages/backend/src/stripe-observer.server.ts`: official Stripe SDK, read-only account and expanded PaymentIntent retrieval. Test-only, preprod-only, manual card authorization; compares persisted account/customer/intent/amount/currency bindings and uses the charge's `capture_before`, never metadata or a guessed seven-day window. Normalized observations match `PaymentAuthorization` and expire after at most 60 seconds. Observation is not capture permission.

## Configure after credential rotation

`provisioning:requestObservation` accepts explicit `observe-test-payment` consent
from the authenticated quote buyer and requires an existing immutable payment.
It schedules one read-only observation, not creation or recurring monitoring.
New jobs persist their creation/observation mode; observation jobs fail closed if
their payment binding disappears. Lease, generation and revocation checks apply,
and the prior observation is invalidated before a fresh attempt. Creation jobs
are not taken over while their lease is active; wait for completion
before requesting observation. Existing legacy
jobs keep their original creation-consent semantics until a new request replaces
their generation. There is no automatic confirmation, capture or settlement.

The [internal provisioning boundary](trusted-provisioning.md) documents the
server-only operator/source allowlist and immutable audit workflow. This is not
independent source verification or a public input-ingestion endpoint.

Treat pasted app secrets, payment keys and wallet recovery material as compromised, including test credentials. Rotate/revoke them and create a fresh wallet; never import the disclosed recovery material. Keep replacements out of Git, screenshots, logs and browser configuration.

1. Install blueprint pins `convex@1.45.0`, `stripe@22.6.1` (browser authentication separately uses `@privy-io/react-auth@3.40.0`). No server Privy SDK/app secret is needed for JWT validation.
2. Select an approved **development** Convex deployment. Configure `PRIVY_APP_ID=<public-app-id>` in its environment, and the matching public app ID in the browser. The app ID is public: retain the existing ID if retaining the Privy app; rotating its exposed secret does not require a new app ID. Verify that the JWKS endpoint `https://api.privy.io/v1/apps/<app-id>/jwks.json` supplies the real access token's key ID before rollout. Do not disable audience validation to fix setup errors.
3. Run Convex's authenticated CLI deployment/code generation against that development deployment. This repository supplies no deployment credentials and claims no hosted deployment; isolated local Convex deployment/admission evidence is recorded separately below.
4. Configure `STRIPE_SECRET_KEY=<replacement-test-key>` only in the server-side Node action environment. A restricted observer-only test key needs account and PaymentIntent read access (including expanded latest-charge data). The provisioning path additionally retrieves Customers and creates PaymentIntents: approve Customer read and PaymentIntent write permissions before enabling it. An observer-only key cannot provision intents. The current internal worker uses this same environment key for both paths; it does not implement separate credential routing. Both adapters reject live keys/objects, send no `Stripe-Account` override and support no Connect transfers. Never put the key in browser configuration.
5. Establish reviewed server-owned membership, approved-quote and Stripe customer ingestion before enabling buyer requests. These write APIs are still missing; do not seed invented provider records to unlock admission. The internal worker creates the immutable payment binding after provider creation and writes observations on refresh. Never accept browser-supplied bindings or normalized observations. Only Node actions may import the `.server.ts` adapters, not browser code, Convex queries or mutations.

### Commands

Offline verification (no login or deployment):

```sh
sh scripts/with-bun.sh node_modules/typescript/bin/tsc --noEmit
sh scripts/with-bun.sh node_modules/typescript/bin/tsc --noEmit -p convex
sh scripts/with-bun.sh test packages/backend
```

The root config includes `convex/**/*.ts`; `convex/tsconfig.json` also enables the Convex CLI's own typecheck. An optional root `typecheck:convex` script can use the second command verbatim.

Only after an operator approves the development deployment, authenticates the CLI and confirms its target, replace both placeholders below. These commands mutate remote configuration and deploy schema/functions; they have **not** been run. Never substitute a production deployment, use `--prod`, or disable typechecking.

```sh
sh scripts/with-bun.sh node_modules/convex/bin/main.js env set PRIVY_APP_ID '<public-app-id>' --deployment-name '<approved-development-deployment-name>'
sh scripts/with-bun.sh node_modules/convex/bin/main.js dev --once --typecheck enable --deployment-name '<approved-development-deployment-name>'
```

The second command generates Convex API types and pushes the schema/functions. Review generated files afterward and rerun offline verification. Stripe credentials are not required merely to deploy the schema/functions, but are required to execute the internal Stripe action successfully. It is not a public callable action; the authenticated consent-gated request mutation schedules it.

## Remaining gates

Internal intent provisioning, binding lookup and generation-guarded observation persistence are implemented. One-shot requests and separately consented bounded recurring observation are implemented; neither is unbounded background reconciliation. Internal audited membership/approved-quote/customer writes exist, but verified source ingestion, chain-observation ingestion, confirmation UI, webhook ingress, capture/settlement, void/refund and mainnet execution remain absent. Creating an unconfirmed intent does not authorize or collect payment; separate consented wallet transport is not connected to this backend or UI.

Unit tests cover normalization and identity guards. Separately, the real local Convex engine passed concurrent single-binding and restart-persistence checks with synthetic inputs. The connected checkpoint also records local deployment of the updated schema/functions and admission regression; payment-worker provider effects and concurrency were tested only with doubles, not real Stripe. Hosted JWT verification and Stripe connectivity remain unverified. Before connection, prove expired/wrong-audience/wrong-signature tokens are rejected; real membership lifecycle and provider retrieval work; expiry/staleness block admission; and hosted canonical bindings cannot fork. A receipt fingerprint is not a provider signature or chain-finality proof.

Observation freshness starts before the PaymentIntent request, so network latency cannot extend its validity. Partial captures cannot be reused as a full authorization; invalid or missing provider expiry fails closed. Neither a successful read nor an `authorized` observation schedules payment effects.

## References

- [Convex custom JWT validation](https://docs.convex.dev/auth/advanced/custom-jwt)
- [Privy access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens)
- [Stripe authorization/capture expiry](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)
- [Canonical package and JWKS decisions](../01-blueprint.md#34-convex-authentication-storage-and-execution-boundaries), [backend responsibilities](../06-backend-design.md#3-proposed-convex-module-responsibilities)
