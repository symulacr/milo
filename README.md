# milo

private agreements. clear approvals.

a privacy-first commissioning workspace for one fixed-price three-image deal. midnight enforces the
order rules. stripe handles payment off chain.

## demo

![milo walkthrough](demo.gif)

[walkthrough](https://youtu.be/bF968ODpTos) · [live workspace](https://milo-xkq.vercel.app)

## status

R0. provider acceptance 0/6, operation acceptance 0/14.

| layer | where | status |
| --- | --- | --- |
| browser workspace | local, in-memory | resets on refresh |
| contract | local chain | 14 proof circuits, tested |
| native and backend | local node, prover, backend | staged deploy, test doubles |
| providers | preprod | not admitted |

no preprod transaction has run. staged bootstrap runs locally, because the full deployment exceeds the
execution budget.

## architecture

solid edges are implemented locally, dashed edges are the target flow.

```mermaid
sequenceDiagram
    accTitle: Milo local and target paths
    accDescr: Solid arrows are implemented locally. Dashed arrows are the target flow.

    actor User
    box rgba(84, 52, 215, 0.12) implemented locally
        participant UI as React UI
        participant Local as Domain simulator
    end
    box rgba(92, 90, 87, 0.14) target only
        participant Wallet as Lace wallet
        participant Chain as Midnight node
        participant API as Convex backend
    end

    rect rgba(84, 52, 215, 0.10)
        Note over User,Local: <b>implemented local paths</b>
        User->>UI: open sample workspace
        UI->>Local: simulate order
        Local->>UI: in-memory state and receipt
    end
    rect rgba(92, 90, 87, 0.14)
        Note over User,API: <b>target connected flow</b> <i>not evidence</i>
        User-->>UI: sign in and consent
        UI-->>Wallet: connect preprod wallet
        UI-->>API: quote request with token
        Wallet-->>Chain: <b>submit</b> via provider route
        Chain-->>API: observed contract state
        activate API
        API-->>API: <b>validate and bind</b>
        deactivate API
        API-->>UI: observed order and receipt
    end
```

the lanes never meet, so no complete order is verifiable end to end.
[contract readme](packages/contract/README.md) covers each circuit.

## run it

needs linux x86_64, node, npm, python 3, curl, tar/xz, sha-256.

```sh
sh scripts/setup.sh
npm run dev        # localhost:3000, /demo, /orders/sample-001
npm run contract:compile
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

compile before typecheck or tests. generated keys stay in ignored
`packages/contract/generated/`. the build writes static output and three public settings to
`dist/api/public-config`. the [integration readme](packages/integration/README.md) covers the native lane. `bun run
test:integration` provisions the pinned node and reinstalls the integration dependency
set on every run. it admits no order.

## safety

keep `PRIVY_APP_SECRET` and `STRIPE_SECRET_KEY` server side. rotate any secret shared in chat, and replace
any wallet whose seed was disclosed. sample receipts are not proofs.

## license

mit, see [LICENSE](LICENSE). third-party material keeps its own license, see
[third-party notices](THIRD_PARTY_NOTICES.md). the spec corpus is unpublished.
