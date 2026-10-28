# Internal provisioning boundary

`convex/trustedProvisioning.ts` provides internal-only `provision` and `revoke`
mutations for immutable membership, approved-quote and Stripe-customer bindings.
They are not browser endpoints and do not verify external source authenticity.
No production or public-network acceptance follows from creating these records.

## Authority and evidence

An approved internal caller must independently verify membership authority,
catalog approval and customer ownership **before** invoking provisioning. Convex
internal-call access is the authority boundary; audit labels are not a login or
signature. Keep admin credentials server-side and never make an unauthenticated
proxy to these mutations.

The server setting `MILO_TRUSTED_PROVISIONING_AUTHORITIES` must be an explicit JSON
array of allowed `{ "operatorId": "…", "sourceId": "…" }` pairs. Missing, malformed
or unmatched configuration fails closed. It is configuration, not a credential.
Do not configure a synthetic fixture source for connected orders.

Each request supplies a stable `requestId` and provenance containing the allowed
operator/source pair and a 64-character lowercase hexadecimal
`evidenceFingerprint`. The caller retains the verified evidence in approved
private storage; a fingerprint alone does not prove its truth. Do not put raw
documents, secrets, payment details or private terms into audit identifiers.

## Lifecycle

- Provisioning atomically inserts the target, immutable binding and audit row.
- Reusing the original request with identical contents is idempotent while active;
  changed contents conflict. New requests cannot overwrite, adopt or reactivate
  existing bindings. Customer identities cannot be shared across buyer bindings.
- Quotes must satisfy the existing frozen-quote timing and fixed image-pack policy.
  Versioned public constructor inputs include all three role commitments. The
  `milo:compact-configuration:v1` encoding uses lowercase nonzero 32-byte hex,
  UTF-8 network names right-padded with zeros, and safe integer deadline seconds
  converted losslessly to `Uint<64>`. Roles must be distinct; deadlines ordered.
  Derived roles and initial-ledger fingerprints must match the supplied inputs.
  These public commitments are correlatable, not capability secrets or ownership
  proof. Never persist terms openings, signing keys or role secrets here.

Existing records without these required inputs are not automatically migrated:
the combined roles fingerprint cannot recover individual commitments. A deployment
with legacy rows needs a separately reviewed data migration from authoritative
source inputs before the stricter schema can deploy. Do not invent commitments,
rewrite an immutable quote in place, or treat local fixture resets as migration.
- Revocation requires the expected version and an audited request. It prevents
  future protected operations; membership status is revoked as well.
- Revocation does not undo provider effects already performed. An intent created
  before revocation may require independent operator reconciliation; no automatic
  cancellation, refund or resend is implemented here.
- Legacy operator-provisioned rows keep their existing semantics. Absence of a
  tracking row is not newly treated as revocation. Migration/adoption and source
  replacement need a separately reviewed workflow.

## Verification and remaining work

### Stripe test-customer provider facts (T09b1)

`stripeCustomerProvisioning:provision` is a new **internal-only** Node action.
It takes `requestId`, `operatorId`, `sourceId`, `buyerAccountId`,
`stripeAccountId`, and `stripeCustomerId`. It does not accept an evidence hash,
customer object, email match, metadata claim, or browser-supplied authority.
The operator must separately approve and retain evidence for the buyer mapping
before invoking it; this action is not a workaround for missing ownership evidence.

The adapter checks the existing configured operator/source allowlist and bounded
identifiers before creating a client. It reuses `testStripeClient()` with the
pinned API version, test-key validation, timeouts and retry limits. Only the
credential's current account and the requested customer are retrieved; no Connect
account override is permitted. Exact account/customer matches, `livemode: false`
and a nondeleted customer are required. Use secured test credentials with the
required read permissions; never paste keys into chat or expose an admin proxy.

The adapter derives a versioned SHA-256 digest of normalized provider facts and an
explicitly **operator-asserted buyer mapping**. Email, metadata, raw responses and
timestamps are excluded. Identical verified facts therefore retain the same digest
across retries. Raw provider/client errors are replaced with a fixed error message.
The existing `trustedProvisioning:provision` mutation receives only its normal
customer payload/provenance and rechecks the current allowlist at commit. Its
immutable binding, request conflict, revocation and cross-buyer uniqueness rules
remain authoritative. Direct internal provisioning is not removed or upgraded into
an independently verified source by this change.

**A successful real-provider read establishes:** the customer exists in the
authenticated Stripe account's test context at the time of the read. **It does not prove:** ownership
by a Milo buyer, Privy subject or wallet; membership/catalog approval; current payment
authorization; or permission to create, confirm, capture, settle, refund or cancel.
Email and caller-written metadata do not close the ownership gap. An authoritative
ownership/membership/catalog source and reviewed operator workflow remain T09b2.

`npm run test:convex-local -- --customer-source` is the explicit isolated synthetic
provider mode. It retains the real Node action and provisioning mutation while
replacing only the copied read-client factory. Default and monitoring verification
do not install this source fixture. Native or unit results do not establish real
Stripe connectivity, hosted operator authentication, or source ownership acceptance.
The [source-bound local receipt](receipts/stripe-customer-provider-facts-2026-09-12.json)
records the 19 native source cases and the exact limitations of this checkpoint.

### Earlier verification

The earlier backend checkpoint passed 130 tests, including handler-level revocation
coverage through freeze, request, begin, finish and admission. Completion rechecks
the consenting membership after external I/O, before accepting provider results.
Handler tests use explicit database doubles. They are not evidence of hosted
authorization, independent identity/customer/catalog verification, or native
transaction acceptance. The real local Convex harness now also provisions synthetic
membership, customer and quote records through the actual internal mutations.
It checks concurrent idempotency, immutable/request conflicts, internal-only access,
revocation, exact audit/target contents and restart persistence. Its explicit local
operator/source labels are fixtures, not source authentication or attestation.

The expanded scenarios include different-payload first-write races on absent keys
for all three kinds (six requests, three winners, three rejected losers) and 24
concurrent identical revocation requests (three audit records, 21 replays).
Restart preserves the winning payloads, rejected losers and audit counts.
The [source-bound receipt](receipts/provisioning-persistence-2026-09-11.json) retains
the exact local evidence and false external-authentication/attestation flags.

Independent ownership/membership/catalog source adapters, reviewed operator access, hosted operating evidence,
safe migration/replacement, chain-observation ingestion and connected UI/provider
acceptance remain open. See [the live manifest](../EXECUTION_MANIFEST.md) for fresh
test results and [the task list](../TASKS.md) for outstanding work.
