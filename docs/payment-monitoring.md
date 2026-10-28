# Bounded payment observation

This backend checkpoint adds recurring **read-only** observation of an existing
immutable Stripe test-payment binding. It does not confirm, capture, refund, or
create a payment. **R0 / 0-of-6 providers / 0-of-14 operations remain unchanged.**

## Consent and lifecycle

- `paymentMonitoring:start` takes `quoteId`, `expectedVersion`, and the separate
  literal consent `monitor-test-payment`. The caller must be the authenticated
  active buyer with matching frozen quote, customer, and payment bindings.
- Each session lasts five minutes. Successful completion, blocked provider reads,
  and read failures schedule another observation after 15 seconds, bounded by that
  original deadline. A 60-second watchdog recovers a stalled read lease without
  extending consent. These are server-owned limits, not caller-selected values.
- Starting again while a session is active fails; it does not silently renew
  consent. A new session after stop or expiry requires another explicit start.
- `paymentMonitoring:stop` takes `quoteId`. Only the original authenticated
  consenting subject may stop it, including after membership revocation. Repeated
  stops are harmless. Controls are available on `/connections` after the existing
  Privy/Convex session check succeeds; sample orders are never used as input.
- Monitoring cannot take over queued/running creation or one-shot jobs, even when
  their leases are stale. Creation and manual refresh requests require the active
  monitor to be stopped first. Their existing recovery semantics are unchanged.

## Fail-closed persistence

`paymentMonitoring:status` is an authenticated, redacted query returning only
`quoteVersion`, `canStart`, `canStop`, `state`, and `expiresAt`. An original consent
owner can inspect withdrawal state after revocation without regaining start
permission. The optional `refreshToken` changes the query cache key, never authority.
Manual refresh uses a new token because the installed Convex client can otherwise
return cached query results; elapsed time alone does not invalidate a subscription.

The UI requires explicit per-quote consent, uses the server's quote version, fences
duplicate requests and stale responses after identity/quote changes, and labels the
last checked state. Local expiry disables start but never grants renewal permission.
An uncertain mutation result requires a fresh status read, not a blind retry.

`paymentMonitoring:tick`, `begin`, and `finish` are internal mutations; the
`stripeMonitoring:run` Node action imports only the retrieval adapter. Persisted
session generations, attempt numbers, and read claims fence duplicate callbacks,
old watchdogs, and in-flight results after stop or restart.

Membership, frozen quote, customer, immutable payment, and trusted provisioning
records are snapshotted and rechecked across provider I/O. A change stops the
session. Each refresh invalidates its previous observation before I/O; failed or
blocked reads cannot leave the prior authorization usable. Stored authorization
freshness is capped at the consent deadline.

Admission independently checks a monitoring receipt's active generation, deadline,
and current authority binding, so delayed scheduler cleanup cannot keep revoked or
expired monitoring evidence usable. Cleanup removes only its own receipt; it must
not delete a later, independently consented one-shot observation.

## Verification boundary

See the [live execution manifest](../EXECUTION_MANIFEST.md) for current command
results. Unit tests use transaction/worker doubles. The isolated local Convex
harness exercises native transactions and scheduling with explicitly synthetic
provider responses; its fixture functions are never part of application deployment.
Run `npm run test:convex-local` for unchanged production adapters and
`npm run test:convex-local -- --monitor` for the explicit synthetic scheduler mode.
The latter verifies four scenarios, including same-database restart and in-flight
stop/revocation/expiry. Expiry uses backdated fixture consent; stalled recovery and
read-error cases are unit-tested with transaction doubles. The source-bound
[receipt](receipts/bounded-payment-monitoring-2026-09-12.json) records these limits.
The later status/control checkpoint also verifies public query authorization and
redaction on native Convex. Actual control components were exercised in Chrome
with a private synthetic transport; the real application separately displayed its
unconfigured-auth state. This does not verify the hosted authenticated control flow.
Neither form of evidence verifies Stripe effects, hosted Privy authentication,
public-chain execution, or settlement. Real test-provider execution, confirmation
and settlement UI remain separate pending work.
