# 2. Fix the contract by redeploying, not by in-place maintenance

Status: Proposed, 2026-10-26. Not applied.

## Context

`escalateUnreviewed` moves an order to DISPUTED without setting `evidenceCommitment`. `resolve` requires a non-empty value equal to that commitment, so an escalated dispute can never be resolved. It can only expire into a cancellation.

Contract maintenance exists on midnight-js 4.1.1: all 14 circuits expose `insertVerifierKey` and `removeVerifierKey` (checked by running the code). A changed circuit would still need the old key removed before the new one is inserted.

## Decision

Redeploy the fixed contract and mark orders on the old contract as legacy. Do not replace keys in place.

## Why

- Between the remove and the insert, `escalateUnreviewed` cannot be called. That recreates the bug for the window.
- The replacement needs the maintenance signing key and an unlocked authority.
- It cannot be rehearsed on a copy.

## Consequences

- The fix is a small change to `packages/contract/src/order.compact`: set a non-default evidence commitment when escalating.
- Existing Preprod orders stay on the old contract. New orders use the new address.
- Run one full Preprod order on the current contract first, so the new contract is checked against a known good flow.
