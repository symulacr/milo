# 1. Authorize and capture, not escrow

Status: Accepted, 2026-10-26.

## Context

Milo needs a buyer's money committed before the studio starts, and released only when the buyer approves. Stripe states that it does not provide escrow services and lists escrow services as a restricted business.

## Decision

Authorize the card when the order is accepted. Capture it when the buyer approves. Release the hold if the order expires or is cancelled. Use no wording such as "escrow", "held in trust" or "guaranteed" in the product, the legal pages or email.

## Consequences

- The four order windows (121 hours) must stay inside the card authorization window (7 days for most cardholder-initiated payments). The capture deadline comes from Stripe's `capture_before` and is stored per intent.
- Moving money to the studio is not built. Stripe Connect or an off-platform payout under contract is an open decision.
- Live mode stays refused until the payout model, the legal wording and a restricted key are in place.
