# Backend policy preparation

This package contains backend policy and server-only Stripe adapters, **not a connected hosted backend**. The repository also implements actual Convex admission, approved-quote freezing and internal test-intent provisioning/observation. Local Convex deployment and atomic admission evidence exist; hosted authentication, real Stripe effects and connected UI remain unverified. No B, M, R, provider or protocol gate closes. See the [current checkpoint](../../docs/connected-implementation.md) and [provider setup/permissions](../../docs/provider-setup.md).

The separate native [admission observer](../../packages/integration/src/admission-observation.mjs)
now produces this policy's version-2 `ObservedDeployment` shape after checking
independent expected configuration, exact keys/lock and finalized node/indexer
state. Records require block hash/height, serialized-state provenance and all four
immutable `*DeadlineSeconds` fields derived from the inspected original ledger.
Version-1 records and fingerprints are historical and intentionally fail closed;
do not relabel or backfill them as version 2. The current Convex schema and local
deployment do not establish a hosted migration. Native observer interoperability
uses explicit test doubles, not real authenticated payment or trusted chain
ingestion. Separate local Convex tests verify atomic admission persistence with
synthetic inputs; they do not connect that observer to a hosted application.

Admission matches each observed deadline to the frozen quote, requires admission
strictly before acceptance, and checks
`resolutionDeadlineSeconds * 1000 + captureSafetyMarginMs < captureBeforeMs`.
The repository supplies a positive server-owned margin via
`getAdmissionTimingPolicy(network)`; the payment observer must independently
retrieve actual provider expiry in milliseconds. Missing/invalid policy or expiry
rejects admission, including an otherwise active hold or already-bound request.
There is no default margin and no browser override. Deadline comparisons use exact
`BigInt` arithmetic; safe-integer seconds, nonnegative millisecond timestamps,
strict deadline ordering and the exact equality boundary are tested. This is
application policy, not a payment oracle or permission to submit `reserve`.

`admission-policy.ts` accepts only quote, deployment-observation, payment-authorization IDs and an address. An atomic repository implementation must obtain the authenticated buyer and server clock itself, then retrieve frozen quote policy, current independently observed `authorized` payment state, and trusted chain observation. The policy checks the exact quote/version/amount/currency, active provider window, roles, approved artifact/verifier-key set, complete fourteen-entrypoint set, genesis, `DEPLOYED` revision zero initial state, bounded observation freshness, and locked-maintenance receipt provenance. It atomically preserves canonical quote, `(network, nonce)`, and reverse-address uniqueness. Browser claims, caller time, untrusted flags, secrets, and private fields are rejected. Receipt fingerprints are opaque internal-port records: this package does **not** cryptographically verify provider receipts or signatures.

`reconciliation.ts` supplies pure durable-inbox state transitions. A production adapter must persist the unmatched signed webhook payload before later reconciliation, preserve event-ID payload identity, and bind every event to the immutable operation/order/version/original idempotency key. Terminal payment outcomes cannot regress; webhook timestamps order provider observations only and never trigger capture.

`delivery-policy.ts` checks exact-three PNG/JPEG/WebP manifests with a 5 MiB
per-file ceiling against internally inspected stored-byte digests, sizes and types.
Finalization requires unexpired owned grants, distinct unattached storage objects,
and atomic manifest insertion/grant consumption. Protected reads recheck active
membership, invitation, disabled status and buyer/merchant/assigned-dispute scope;
buyer/operator reads additionally require the internal observer to bind the exact
manifest to confirmed chain delivery. Its return value is an internal descriptor
for authenticated byte streaming, never a browser response or public storage URL.
The actual storage inspection/streaming, commitment recomputation, Convex mutation,
authentication and retention adapters remain unimplemented.

Reconciliation separately keys authorize/capture/void by `(order, operation,
version)` and retains the original provider key. Strict event schemas reject unknown
runtime states and additional payload fields. These reducers do not verify webhook
signatures or execute an external effect; the adapter must verify raw signed bytes,
normalize allowlisted fields and persist state atomically before further work.

Package policy/worker tests use explicit transaction/state/provider doubles. The separate real local Convex admission suite checks concurrency and restart persistence, not actual payment-worker provider effects or concurrency. Neither establishes payment collection, browser approval, chain proof, hosted provider authentication or production persistence.

`stripe-provisioning.server.ts` creates unconfirmed manual-capture test intents;
`stripe-observer.server.ts` retrieves account/intent state read-only. The internal
Node action `stripeProvisioning:run` invokes them after a consent-gated authenticated
`provisioning:requestPayment` mutation schedules one-shot work. Internal
`provisioning:begin`/`finish` mutations protect claims and observation ordering;
they are not public ingestion endpoints. Periodic refresh, trusted membership,
approved-quote/customer and chain-observation ingestion, payment confirmation,
capture and settlement remain incomplete. Pure webhook reducers above are not
implemented webhook ingress.
