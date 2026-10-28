# Connected implementation checkpoint — 11 September 2026

Later repair/provisioning work is tracked in the [live manifest](../EXECUTION_MANIFEST.md).
The later [bounded monitoring checkpoint](payment-monitoring.md) adds separately
consented recurring reads; the original verification below predates that work.
Internal audited membership/catalog/customer writes now have a
[separate boundary](trusted-provisioning.md); this checkpoint's original verification
below predates them. Real source verification and connected acceptance remain open.

This checkpoint implements prerequisites, not an end-to-end order. **R0, 0/6
providers and 0/14 operations remain unchanged.** No wallet secrets were used,
payment requests sent, or chain transactions submitted.

## Implemented

- **Separate Preprod profile:** fixed official endpoints, explicit genesis/runtime
  pins, mixed-local-profile rejection, and an artifact/cohort deployment preflight.
  The native bootstrap and contract admission observer still reject non-local
  networks. Preflight does not contact the prover or deploy a contract.
- **SDK reconciliation:** direct Wallet SDK 1.2.0 matches the current official
  Preprod matrix. Testkit retains its declared 1.1.0 barrel; tests verify shared
  concrete facade, address codec and ledger identities without dependency overrides.
  Historical native transaction receipts do not verify this changed dependency graph.
- **Lace transport:** actual v4 `balanceUnsealedTransaction` and `submitTransaction`
  boundaries, separate digest-bound consent, wallet/network rechecks, single-use
  capabilities and observation-only recovery. Supports deployment and all 14
  operation names, but names do not prove transaction semantics. No UI exposes it.
- **Quote freezing:** authenticated buyer freezes an existing approved quote by ID
  and version. Immutable fields, USD and the fixed image-pack policy are checked.
- **Stripe provisioning/reconciliation:** buyer-consented internal worker creates
  an unconfirmed manual-capture test intent using trusted quote/customer bindings.
  Stable idempotency keys, bounded retries, generation claims and internal-only
  observation writes reject stale workers/replays. Refresh invalidates old payment
  observations before external I/O. Creation never confirms or captures a payment.
- **Contract adversarial coverage:** all 14 generated-runtime lifecycle entrypoints
  now reject exhausted revisions without changing state. Existing role, stale
  revision, terminal-state, delivery, dispute and deadline tests remain intact.

## Still required to execute an order

1. Native Preprod contract construction, staged deployment, proving/fee measurement
   and independent locked-policy/contract-state observation. Public block agreement
   is not this evidence; remote indexer/prover versions are not verified.
2. Concrete authenticated transaction-authority and submission-authority backends:
   semantic validation of canonical transaction bytes, durable atomic consumption,
   submission journaling and independent finality/recovery observations. The Lace
   transport currently requires these as injected interfaces and has no default
   permissive implementation. Deployment/reservation UI wiring remains absent.
3. Audited approved-quote/customer/membership provisioning, Stripe confirmation UI,
   periodic refresh and trusted chain-observation ingestion. Approved-quote and
   deployment-observation ingestion remain unverified: approved quotes now have an
   internal audited write boundary, while deployment observations still have no
   application write API. An approved image-pack attestation does not independently
   prove the private terms opening.
   T10a now stores versioned public constructor inputs, including all three role
   commitments, and checks generated-constructor/fingerprint parity. The existing
   observer still accepts only `undeployed`; this does not implement trusted
   Preprod ingestion or close artifact/key/network/state provenance requirements.
4. A fresh user-controlled Preprod Lace wallet and secured rotated test credentials,
   then real provider, wallet, complete lifecycle and recovery execution. Do not
   supply recovery phrases or API secrets in chat. Settlement/capture remains absent.

## Verification

- 215 unit tests / 1,068 assertions; 104 isolated SDK tests on Node 24.20.0.
- Root and Convex typechecks, lint, production build and plan checks passed.
- Real local Convex deployed the updated application functions/schema and preserved
  admission behavior: 16 calls, one binding, seven replays, eight conflicts, restart
  persistence. This does not test the new payment worker's actual provider effects
  or concurrency; its worker tests use explicitly labeled doubles.
- Read-only Preprod profile observed node/indexer agreement at height 2,501,053.
  [Source-bound receipt](receipts/connected-prerequisites-2026-09-11.json).
  One preceding capture failed closed; the separate retry above succeeded.
- Independent source review found no blocking flaw. No live Lace, Stripe, hosted
  authentication, circuit proof or full lifecycle acceptance is claimed.

See [integration commands](../packages/integration/README.md),
[backend boundaries](../packages/backend/ADMISSION.md), and
[network policy](network-policy.md). Existing dated receipts remain historical.
