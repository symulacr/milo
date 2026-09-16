# Milo

**Private agreements. Clear approvals.**

A privacy-first creative commissioning workspace: one fixed-price agreement and
one delivery of three images. Midnight is intended to enforce private order rules;
Stripe handles payment outside the chain. This is **not a live marketplace,
escrow service or admitted end-to-end Midnight application**.

## Demo

[![Milo. One private commission end to end.](https://img.youtube.com/vi/bF968ODpTos/maxresdefault.jpg)](https://youtu.be/bF968ODpTos)

Click the preview to watch the walkthrough on YouTube. A page that embeds the
player directly is at [milo-xkq.vercel.app/watch.html](https://milo-xkq.vercel.app/watch.html).
GitHub strips `iframe` and `video` tags from Markdown, so a direct embed cannot
render inside this file.

## Status

**R0 — bounded implementation evidence. Provider acceptance: 0/6; operation
acceptance: 0/14. R1–R5 remain open.** The progress manifest owns readiness;
installed SDKs and successful wallet connections do not close gates.

| Layer | Current boundary |
| --- | --- |
| Browser demo | Fictional participants, original sample PNGs and reset-on-refresh simulation; role changes are not authorization |
| Compact contract | Real contract, generated artifacts and local runtime tests; 14 proof circuits |
| Native Midnight | Isolated node/indexer/prover, staged deployment and maintenance/recovery diagnostics; no canonical admission or buyer reservation |
| Connected providers | `/connections` diagnostics for Privy/Lace and optional Convex authentication are separate from synthetic orders; Stripe is read-only test preparation, not settlement |
| Public networks | Preprod is the connected testing target; mainnet is gated and not enabled |

The full single-transaction deployment exceeds the measured execution budget.
Staged bootstrap installs the original keys and locks
maintenance on a disposable local address; it does not prove a business circuit
or admit an order. See the integration map.
No Preprod transaction has been executed. The native admission observer remains
restricted to the isolated `undeployed` network, not a verified Preprod stack.

The [Convex admission mutation](packages/backend/ADMISSION.md) now has real local
concurrency/restart evidence: one canonical binding across 16 competing calls.
Its test inputs are synthetic; trusted provisioning and real provider acceptance
remain open. Run `npm run test:convex-local` for the isolated native database check.

## Architecture and flow

Solid arrows below show implemented **local** paths. Dashed arrows describe the
**target connected order flow**, not completed acceptance evidence. Connection
diagnostics do not join the simulated order state to that target.

```mermaid
sequenceDiagram
    actor User
    participant UI as React UI
    participant Local as Domain simulator
    participant CLI as Native diagnostic / generated contract
    participant Chain as Midnight node + indexer + prover
    participant Auth as Privy identity
    participant Wallet as Lace wallet
    participant API as Convex backend (target)
    participant Pay as Stripe test mode (target)
    rect rgb(235, 245, 250)
        Note over User,Chain: Implemented local paths — independent of each other
        User->>UI: Open sample workspace
        UI->>Local: Simulate order / approval / capture
        Local->>UI: In-memory state and sample receipt
        CLI->>Chain: Disposable staged deployment / maintenance
        Chain->>CLI: Indexed state and diagnostic evidence
        Note over CLI,Chain: No canonical admission or buyer reserve
    end
    rect rgb(250, 245, 230)
        Note over User,Pay: Target connected flow — Preprod, admission and provider gates open
        User-->>UI: Sign in and connect with consent
        UI-->>Auth: Sign in
        Auth-->>UI: Access token
        UI-->>Wallet: Connect Preprod wallet with consent
        UI-->>API: Quote / payment request with access token
        API-->>API: Verify JWT and application authorization
        API-->>Pay: Authorize test payment
        Pay-->>API: Independently verified payment observation
        UI-->>Wallet: Buyer-authorized deployment / proof / signature
        Wallet-->>Chain: Submit through approved Preprod provider route
        Chain-->>API: Independently observed contract state
        API-->>API: Validate quote, policy, payment and atomically bind
        UI-->>Wallet: Reserve, deliver and approve with actor consent
        Wallet-->>Chain: Prove / sign / submit order transitions
        Chain-->>API: Observe approval and reconcile
        API-->>Pay: Capture only after required checks
        API-->>UI: Observed order and payment receipt
    end
```

Midnight does not verify Stripe payment or judge creative quality. Privy identity
does not confer Lace signing authority. The backend must independently validate
observations and authorize actions; a browser success label is not proof.

## Local development

Setup pins Bun, Compact and the supported cohort. Compiler bootstrap requires
Linux x86_64, Node/npm, Python 3, curl, tar/xz and SHA-256 tooling. No provider
credentials are needed for the demo, compilation or local unit tests.

```sh
sh scripts/setup.sh
npm run dev
# http://localhost:3000 — landing; /demo — guided sample tour (public); /orders/sample-001 — sample workspace

npm run contract:compile
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Compile before typecheck/tests after checkout or contract edits. Generated keys
and receipts live in ignored `packages/contract/generated/`. The build produces
static web output, **not a Convex deployment**. Hoplite's managed Preview uses
the run command in `.hoplite/settings.json`.

Static builds write only the three allowlisted public settings to
`dist/api/public-config`. Rebuild after changing them; serve that exact path as
JSON with `Cache-Control: no-store` (the `_headers` file supports compatible hosts).
No server secret is included.

For native services and opt-in disposable transactions, follow
native-network.md and the
[integration README](packages/integration/README.md); these use an isolated pinned
Node runtime. The Docker candidate is separate
and unverified, not the executed native lane.

## Provider setup and safety

Use public `PRIVY_APP_ID` and optional `CONVEX_URL` configuration only for the
browser-facing settings. Keep `PRIVY_APP_SECRET` and `STRIPE_SECRET_KEY` server-side;
never bundle them or put wallet recovery material in environment examples.
See the provider setup and network policy for boundaries and remaining gates.
Use `.env.example` for configuration names. `/connections` keeps missing Convex
configuration explicit; only a successful authenticated backend query establishes
a verified backend session. Privy login alone does not establish that session.

**Rotate any secrets shared in chat, even test keys. Replace any wallet whose seed
or private keys were disclosed.** Never reuse that wallet for mainnet. Use approved
secret storage, a fresh disposable Preprod wallet and Stripe test mode. Do not enter
real credentials, payment details or customer data in the synthetic demo.

Sample receipts are not payment confirmations or chain proofs. Sample hash checks
establish local byte equality, not ownership, creative quality or chain commitments.

## Specifications and continuation

The internal specification and audit corpus (blueprints, manifests, task list and
per-phase verification evidence) is not published in this repository.

- Working task list (TASKS.md) and live execution manifest (EXECUTION_MANIFEST.md):
  current repairs, verification evidence, blockers and next implementation work.

- Blueprint (01-blueprint.md): protocol, privacy and authority; roadmap (02-roadmap.md): acceptance gates.
- Building guide (03-building-guide.md), UI (04-ui-design.md), UX (05-ux-design.md), backend (06-backend-design.md): implementation contracts.
- [Contract README](packages/contract/README.md) and Midnight audit (08-midnight-core-audit.md): circuit and dependency boundaries.
- Execution plan (docs/EXECUTION_PLAN.md), handoff (docs/AGENT_HANDOFF.md), deployment checklist (docs/DEPLOYMENT_TODO.md): next work.
- Verification (VERIFICATION.md), protocol verification (PROTOCOL_VERIFICATION.md), changelog (CHANGELOG.md): recorded evidence and changes.

## License

Project-original material is licensed under [MIT](LICENSE). Third-party and derived
material retains its own license; see [third-party notices](THIRD_PARTY_NOTICES.md).
