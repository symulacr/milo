# Convex admission boundary

`convex/admission.ts` exposes `admission:bind` with only quote ID, expected quote
version, deployment observation ID, payment-intent document ID (`authorizationId`),
and contract address. Convex validates these arguments. Verified Privy identity
and current active buyer membership in the frozen quote's scope are required.

`src/convex-admission.ts` executes within that mutation. It reads the frozen quote,
quote/version-provenanced deployment observation, immutable payment binding and
current payment observation, server timing policy, and all three canonical
uniqueness indexes. `.unique()` fails closed on duplicate rows; indexes alone are
not database uniqueness constraints. The synchronous policy consumes the loaded
snapshot, collects an insert, and the adapter awaits the actual database insert
before returning success. There is no external network call in this transaction.
Payment observations must retain the observer's at-most-60-second usable window;
the existing policy also validates provider status, capture expiry, chain
freshness, exact deployment policy, and deadlines.

`provisioning:freeze` now freezes a server-approved catalog quote for its current
authenticated buyer, by ID and exact version only. It does not accept caller
amounts, fingerprints or deadlines. A replay returns the existing frozen document
only if all immutable fields still agree. Catalog approval, memberships and
Stripe customer linking remain trusted operator provisioning prerequisites: no
application write APIs for these inputs are exposed.
The external trusted approval process must supply `imagePackPolicy` with
service version 1, quantity 1, exactly three outputs, and a positive integer
unit price equal to the quote total. Freezing rejects every currency except USD,
matching the current contract. This is an approval attestation, not independent
verification of the private terms opening; the contract checks that opening.
Approved quote and customer provisioning are not implemented by this patch and
must remain an authenticated, audited operator/internal process, never public
caller writes.

`provisioning:requestPayment` requires current buyer membership, the frozen
version, and explicit `create-test-payment` consent. It transactionally schedules
an internal worker, recording the consent subject/time and a monotonically
increasing generation. Duplicate requests reuse an active 60-second lease;
recovery supersedes the generation without changing the Stripe idempotency key
or the quote/customer binding. The worker rechecks membership before external I/O.
Creation uses the official Stripe SDK with API `2026-08-26.dahlia`, test-only
credentials, independently verified account/customer, exact server quote amount,
manual card capture and `confirm: false`. It never attaches a payment method,
confirms, captures, returns a client secret, or fabricates an authorization.

Retrying a completed job independently retrieves its existing provider intent.
Only internal `provisioning:finish` stores the normalized observation, guarded by
the running generation, immutable payment identity, unique provider/quote indexes
and a fresh worker-bounded observation timestamp. Refresh deletes any previous
usable observation before provider I/O, so a provider outage fails closed. The
`paymentObservations.by_payment_intent` index is one current result, not history.
No browser observation or webhook payload is accepted. Creation retries are
blocked 23 hours after the first attempt, before Stripe's minimum 24-hour
[idempotency retention horizon](https://docs.stripe.com/api/idempotent_requests).
An ambiguous creation beyond that horizon needs
operator investigation; blindly creating a new job or resetting its clock is
unsafe. There is deliberately no automatic retry that can bypass this boundary.

## Verification and unclosed gates

`test/convex-admission.test.ts` is explicitly a DB double. It verifies indexed
reads, duplicate failures, conflict snapshots representing a competing winner,
quote-version changes, current authorization/freshness, authorization checks,
and awaited/failed inserts. It does **not** implement or prove Convex OCC,
concurrent mutation retries, hosted JWT validation, or preprod admission.

Still required: approved deployment and generated API; real Privy/JWKS and
membership lifecycle checks; audited catalog/customer provisioning and buyer
Stripe confirmation UI; real Stripe test-mode receipts and hosted worker/OCC
recovery tests; periodic observation refresh orchestration; native preprod chain observer and
maintenance-policy receipts; broader conflict/rollback and hosted acceptance tests;
and independent reserve/settlement integration. Native observer deployment is
still absent. This patch does not close those gates or claim production readiness.

`test/provisioning.test.ts` adds explicit DB and provider doubles for immutable
freezing, unauthorized/revoked buyers, duplicate rows, job deduplication, stale
workers, provider replay, expired retry windows, failed refresh invalidation and
exact non-confirming provider creation. These are not payment or hosted
concurrency receipts. Existing local synthetic fixtures remain separate and
explicit; deployment observation storage still has no application write API.

## Real local Convex verification

Run `npm run test:convex-local` on Linux x64. The isolated project and credentials
stay under ignored `.tools/convex-local`; root environment configuration is not
modified. The exact official native backend is SHA-256 checked before execution.
This uses the [official anonymous local mode](https://docs.convex.dev/cli/agent-mode),
not `convex-test` and not a hosted deployment.

The [source-bound receipt](../../docs/receipts/convex-atomic-admission-2026-09-10.json)
records generated code/typechecking, rejected anonymous/malformed-token access,
16 concurrent admission requests (one winner, seven idempotent replays, eight
conflicts), exactly one persisted binding, and preservation across native restart.
Local admin-injected identities and synthetic chain/payment records are explicitly
not real Privy, Stripe or preprod evidence. Fixture functions are internal and
copied only into the isolated test project, never deployed with the application.

For tamper and SIGINT/SIGTERM cleanup verification:

```sh
npm run setup:integration-runtime
PATH="$PWD/.tools/node-runtime/node-v24.20.0-linux-x64/bin:$PATH" python3 scripts/convex-local-lifecycle-check.py
```

No surviving owned process or lock was observed; an unrelated process remained
alive. SIGKILL cannot run cleanup: inspect ownership before removing a stale lock.
