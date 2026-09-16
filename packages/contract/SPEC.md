# Milo order contract, specification

Overview and the lifecycle diagram are in [README.md](README.md). `order.compact` is
the only source.

## Circuits

25 declared, 16 exported, 2 pure helpers. The 14 proof-bearing transitions are asserted by
`scripts/compile-contract.ts`. Nine internal.

## Invariants

Contract-enforced. 1, no role replacement after reservation, merchant authorization not
first-come-first-served. 2, no accepted or approved action changes the terms commitment. 3, no approval
before submitted delivery, no substitution after. 4, `APPROVED` and `CANCELLED` terminal, stale actions
create no transition. 6, a timeout never fabricates approval, receipt, payment or quality. 7, each actor
acts without another's secret. 11, deployment alone proves neither constructor execution nor a valid
reservation.

Application-level. 5, dispute resolution is a disclosed human authority. 8, the API cannot bypass
circuit authorization by editing cached state. 9, deadlines must outlast a payment authorization, which
the contract cannot verify. 10, a user can export the confirmed public record without the API.

## Payment is not circuit-enforced

Reserve and accept cannot see a Stripe hold or its expiry. A capability holder can submit a valid call
outside Milo without satisfying any payment gate. Milo blocks its own workflow and flags inconsistent
observations, but does not claim the circuit prevents unpaid acceptance. A payment oracle is a separate,
reviewed dependency.

## Boundaries

Actor-local private state holds a capability, the buyer limit and openings, and role secrets never
synchronize through Convex or Cascade. Agreed application data is membership-checked on every protected
operation, and participants verify openings and digests locally. Only permitted circuits change public
ledger state, and commitments plus timing still reveal metadata. Neither a row edit nor a webhook
authorizes a transition, and storage is not settlement.

## Encoding

Commitments use `persistentHash`. `hashTerms` and `hashCapability` are pure, and their openings must
never be transaction arguments.

Terms preimage. `milo:terms:v1`, `Uint<16>` one, network, nonce, `Terms` (`serviceVersion`,
`packQuantity`, `outputCount`, `unitPrice`, `total`, `currency`, `scopeDigest`, `rightsDigest`,
`paymentPolicy`, `salt`). Capability preimage. `milo:capability:v1`, `Uint<16>(1)`, network, nonce,
`Role` (`BUYER=0`, `MERCHANT=1`, `OPERATOR=2`) and a secret.

Rules. No floating point, bounds before arithmetic. Never derive a secret from an
email, order number, price or timestamp. Commit a manifest of immutable digests so replacing a blob at
an old URL fails. Version 1, quantity 1, output count 3, price bounded by `2^64-1`. The buyer limit is
reserve-only and self-declared. v1 commits one bundle, not field-level disclosure.

## Verification

M-02 fixed vectors, separate roles, salts, bounded values and disclosure table map to the encoding
suite, capability preimage, schema rules and boundaries. M-03 compiles every transition, rejects
forbidden ones and tests bootstrap and maintenance through the harness.

The 14 circuits map 1:1 to MID-T01 to MID-T14 in blueprint 3.7. No MID-P slot is closed. Acceptance is 0/6 provider, 0/14 operation.

## State and time

Bootstrap is `DEPLOYED` revision zero, only a buyer `reserve` enters `RESERVED`, and `APPROVED`
and `CANCELLED` are terminal. Predicates are `t < acceptance`, `t < delivery`, `t < review` and
`t < resolution`. Expiry uses `kernel.blockTimeGreaterThan(deadline - 1)`. Tests supply a runtime block
context, not a time witness. Timeouts never execute themselves.
