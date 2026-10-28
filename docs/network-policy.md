# Network and credential policy

## Local evidence is not Preprod evidence

Milo's executed native diagnostic lane uses an isolated `undeployed` network with
disposable local funding. It is not Preview, Preprod or Mainnet. Its staged
deployment, maintenance lock and observer receipts do not establish canonical
admission, reservation or compatibility with a public-network wallet.
No Preprod transaction has been executed. The native admission observer is
restricted to `undeployed`; configuring a Preprod wallet does not port that observer.
The separate Preprod profile now validates public chain pins and supports
artifact/cohort preflight only. See the
[connected implementation checkpoint](connected-implementation.md) for the Lace
transport and trusted provisioning code, and their remaining backend/UI dependencies.

The browser demo is a separate simulator. A Privy login or Lace connection is a
connection diagnostic, not permission to submit an order or claim payment.

## Connected target: Preprod only

The official [Midnight environments and endpoints](https://docs.midnight.network/relnotes/network.md),
checked 10 September 2026, describe Preview as early-stage experimentation,
Preprod as final testing before mainnet, and Mainnet as production. Milo selects
**Preprod** for connected testing; the upstream existence of other networks does
not enable them in Milo.

Official Preprod services currently include:

- Node RPC: `https://rpc.preprod.midnight.network`
- Indexer: `https://indexer.preprod.midnight.network/api/v4/graphql`
- Faucet: `https://midnight-tmnight-preprod.nethermind.dev/`

These are reference endpoints, not a verified Milo deployment profile. Before
submitting, establish the compatible SDK/ledger/service cohort, installed Lace
wallet support, explicit network selection, trusted proving route and user consent.
Do not change the local harness's network or endpoints to repurpose its fixtures
for a public chain. Never infer success from a faucet message or address prefix.

## Read-only Preprod checkpoint — 11 September 2026

Run `node scripts/preprod-observe.mjs` to compare an actual finalized node block
with the public indexer. Endpoints are fixed; redirects, unexpected chain identity,
RPC/indexer errors, unsafe heights and block disagreements fail closed. No wallet,
environment credentials, contract address or transaction submission is involved.
This is a health probe, not the native admission observer or SDK compatibility test.

The [source-bound receipt](receipts/preprod-block-observation-2026-09-11.json)
records agreement at height 2,500,305, node `1.0.2-eb71e64e`, runtime spec 1,000,000.
An earlier attempt failed because the indexer returned no block at the finalized
height; a separate retry succeeded. The command intentionally does not treat lag
as agreement. These version strings do not establish ledger serialization or
compiler/prover compatibility. No Milo contract was observed or submitted.

Requested priority is now Preprod contract observation → buyer reservation →
full lifecycle. Work remaining before reservation:

1. Establish the compatible public-network SDK/ledger/compiler/prover cohort and
   a supported preprod bootstrap profile; do not remove `undeployed` guards from
   `bootstrap.mjs` or `admission-observation.mjs` without this evidence.
2. Provision a fresh wallet through approved secret storage or user-controlled
   Lace, deploy the order with explicit consent, and independently observe its
   locked policy/state against a trusted frozen quote. The disclosed wallet is
   not usable. Local fixture constructors are not public-network order inputs.
3. Provision trusted admission inputs. `convex/admission.ts` deliberately requires
   payment provenance, so deferring Stripe ingestion also blocks canonical buyer
   reservation. Do not insert synthetic payment observations to bypass it.
4. Execute buyer reserve and independently observe RESERVED, then separate orders
   for success, cancel/decline, dispute/resolve and timeout branches with distinct
   actor authorization. Hosted provider setup and Stripe ingestion remain pending,
   not removed from the acceptance requirements.

## Mainnet remains gated

Mainnet is not enabled. It requires separate authorization, supported deployment
configuration, canonical admission, wallet/proving/fee validation, independently
observed payment and full lifecycle/recovery evidence. Readiness remains **R0,
0/6 providers and 0/14 operations** until the
[manifest](../PROGRESS_MANIFEST.md) records acceptance evidence.

## Configuration and compromised material

Only public configuration belongs in the browser: `PRIVY_APP_ID` and, when
configured, `CONVEX_URL`. Privy app secrets and Stripe secret keys must remain in
approved server-side secret storage. The backend test observer uses
`STRIPE_SECRET_KEY`; use test mode only. Follow the
[provider setup](provider-setup.md) for the implemented setup, rather
than assuming an environment variable deploys or authenticates the backend.

Rotate disclosed API secrets even when they are test-only. Treat disclosed wallet
seeds, signing keys and encryption material as compromised: create a fresh
disposable wallet, and never promote or fund the exposed wallet on mainnet.
Do not commit keys, seeds, customer data or wallet-specific configuration. Public
app identifiers are not authorization; backend identity verification, account
configuration and independent payment observations remain necessary.
