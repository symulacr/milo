# milo

private agreements. clear approvals.

a privacy-first commissioning workspace. one fixed-price deal, one delivery of three images.
midnight enforces the order rules. stripe handles payment off chain.
not a live marketplace, an escrow service, or an admitted end-to-end midnight app.

## demo

![milo. one private commission end to end.](demo.gif)

[walkthrough](https://youtu.be/bF968ODpTos) · [live workspace](https://milo-xkq.vercel.app)

## status

R0, bounded implementation evidence. provider acceptance 0/6. operation acceptance 0/14. R1 to R5 open.

| layer | boundary |
| --- | --- |
| browser demo | simulated orders from an in-memory model. role changes are not authorization |
| compact contract | real contract, 14 proof circuits, local runtime tests |
| native midnight | local node, indexer and prover. no canonical admission, no buyer reservation |
| providers | `/connections` diagnostics for privy and lace. stripe is test prep, not settlement |
| networks | preprod is the target. mainnet is gated and off |

no preprod transaction has run. the native observer stays on the isolated `undeployed` network.
the full deployment exceeds the measured execution budget, so staged bootstrap runs on a disposable
local address instead. it does not prove a business circuit or admit an order.

the [convex admission mutation](packages/backend/ADMISSION.md) has real local concurrency evidence.
one canonical binding across 16 competing calls, from synthetic inputs.

## architecture

two lanes that never meet. a reader can verify a real contract and a real local chain lane, but not
a complete order.

solid arrows are implemented local paths. dashed arrows are the target connected flow, and are not
acceptance evidence.

```mermaid
sequenceDiagram
    accTitle: Milo local paths and target connected flow
    accDescr: Solid arrows are implemented local paths. Dashed arrows are the target connected flow and are not acceptance evidence.
    actor User
    participant UI as React UI
    participant Local as Domain simulator
    participant CLI as Native diagnostic
    participant Chain as Midnight node and prover
    participant Auth as Privy identity
    participant Wallet as Lace wallet
    participant API as Convex backend
    participant Pay as Stripe test mode
    rect
        Note over User,Chain: implemented local paths
        User->>UI: open sample workspace
        UI->>Local: simulate order and approval
        Local->>UI: in-memory state and receipt
        CLI->>Chain: staged local deployment
        Chain->>CLI: indexed state and evidence
    end
    rect
        Note over User,Pay: target connected flow
        User-->>UI: sign in and consent
        UI-->>Auth: sign in
        Auth-->>UI: access token
        UI-->>Wallet: connect preprod wallet
        UI-->>API: quote request with token
        API-->>API: verify jwt and authorization
        API-->>Pay: authorize test payment
        Pay-->>API: payment observation
        UI-->>Wallet: deploy, prove and sign
        Wallet-->>Chain: submit via provider route
        Chain-->>API: observed contract state
        API-->>API: validate and bind
        Wallet-->>Chain: sign order transitions
        Chain-->>API: observe approval
        API-->>Pay: capture after checks
        API-->>UI: observed order and receipt
    end
```

midnight does not verify stripe payment or judge creative quality. privy identity does not confer
lace signing authority. the backend must validate observations and authorize actions. a browser
success label is not proof.

## run it

needs linux x86_64, node, npm, python 3, curl, tar/xz and sha-256 tooling.
no provider credentials are needed for the demo, compilation or unit tests.

```sh
sh scripts/setup.sh
npm run dev        # localhost:3000, /demo, /orders/sample-001
npm run contract:compile
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

compile before typecheck or tests, after checkout or contract edits. generated keys and receipts stay
in ignored `packages/contract/generated/`. the build writes static web output, not a convex deployment.
it writes three allowlisted public settings to `dist/api/public-config`, served as json with
`cache-control: no-store`. no server secret is included.

the [integration readme](packages/integration/README.md) covers the isolated native lane.

## safety

use public `PRIVY_APP_ID` and optional `CONVEX_URL` for browser settings only. keep
`PRIVY_APP_SECRET` and `STRIPE_SECRET_KEY` server side, and never bundle them or put wallet recovery
material in environment examples.

rotate any secret shared in chat, even test keys. replace any wallet whose seed was disclosed. never
reuse that wallet on mainnet.

sample receipts are not payment confirmations or chain proofs. sample hash checks establish local byte
equality, not ownership or chain commitments.

## specs

the internal specification and audit corpus is not published in this repository.
[contract readme](packages/contract/README.md) covers circuit and dependency boundaries.

## license

project-original material is MIT, see [LICENSE](LICENSE). third-party material keeps its own license,
see [third-party notices](THIRD_PARTY_NOTICES.md).
