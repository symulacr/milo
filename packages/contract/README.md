# Milo order contract — local compiler/runtime slice

Canonical authority: blueprint §§2.4, 3.7, 4 and roadmap M-02/M-03. This is an original Milo order state machine, not the synthetic UI/domain simulator. `src/order.compact` is the only contract source. Generated output is disposable; never edit it.

## Toolchain and evidence boundary

- Compact compiler **0.31.1**, language **0.23**, `@midnight-ntwrk/compact-runtime` **0.16.0**, `@midnight-ntwrk/onchain-runtime-v3` **3.0.0**.
- From the repository root, full compilation: `.tools/compact/compiler/compactc packages/contract/src/order.compact packages/contract/generated`. Ensure the compiler's sibling `zkir` is executable; do not use `--skip-zk` for complete artifact evidence.
- Focused harness: `bun test packages/contract/tests` (use the repository-pinned Bun installation). Generated JavaScript and ZKIR without keys are only a partial compiler result.
- Tests execute actual compiler-generated circuits and onchain-runtime query contexts with synthetic inputs. They are **not** proof generation, proof verification, wallet balancing, deployment, node acceptance, indexer observation or browser evidence. MID-T01–T14 names identify runtime-owned portions only; no provider/operation row is closed by these tests.
- Constructor tests validate computed bootstrap configuration/state. Raw-ledger injection tests bypass constructor validation and require the proved `reserve` circuit to reject malformed configuration and bootstrap fields. This is generated-runtime evidence, not malicious network deployment evidence. Verifier-key substitution, canonical address admission, authority relinquishment and maintenance/circuit replacement still require the supported local-network integration. No invented maintenance-disable API exists here. Block immutable-order admission until those checks pass.

## Versioned encoding

All commitments use Compact `persistentHash` and its typed field alignment, not JSON or a separately chosen hash. `hashTerms` and `hashCapability` are exported **pure** helpers; their openings must not be sent as transaction arguments. Their generated TypeScript implementations are the client encoding entry points.

Terms preimage, in exact order:

1. `Bytes<32>` zero-padded UTF-8 `milo:terms:v1`.
2. Protocol/schema `Uint<16>` value `1`.
3. `Bytes<32>` network identifier and `Bytes<32>` random order nonce.
4. The `Terms` struct: `serviceVersion: Uint<16>`, `packQuantity: Uint<8>`, `outputCount: Uint<8>`, `unitPrice: Uint<64>`, `total: Uint<64>`, `currency: Bytes<3>`, then `scopeDigest`, `rightsDigest`, `paymentPolicy`, `salt`, each `Bytes<32>`.

Capability preimage: padded `milo:capability:v1`, `Uint<16>(1)`, network, nonce, typed `Role` (`BUYER=0`, `MERCHANT=1`, `OPERATOR=2`), and `Bytes<32>` capability secret. Roles are independently witnessed; no action requests another actor's secret. Domain/role/network/nonce binding does not prevent a byte-identical deployment clone: canonical quote-to-address admission remains mandatory. The configured network label must be independently checked against the actual network.

For this schema, service version is `1`, quantity `1`, output count `3`; integer unit price is positive and bounded by `2^64-1`. Quantity is constrained before multiplication, making the total representable in `Uint<64>`. Reservation checks the buyer-only limit. `Terms.currency` is a private committed witness field checked against the build-time `USD` constant for this synthetic artifact. There is no public configuration field or caller-selected policy witness. Changing currency requires new reviewed source/artifacts and admission, never an app configuration change to this deployment. Currency remains inferable from the public deployment policy: removing the ledger field is not a currency-confidentiality guarantee. Its exponent and payment semantics are external policy, never inferred as two decimals by the circuit. Scope binds the private service context. All agreed terms are one bundle, not selective-disclosure fields.

Application creation must use fresh cryptographic randomness for nonce, salt and independent capabilities. A circuit cannot prove entropy quality, prevent frontend secret theft or make a remote prover blind. Fixed repeated bytes in tests are synthetic fixtures, not a secret-generation recipe. The encoding suite independently describes the typed terms preimage, consumes a complete encode/decode round trip and compares it with generated Compact output and fixed regression vectors.

The compiler canary injects an undisclosed role-secret ledger write into a temporary copy and requires a disclosure diagnostic from compiler 0.31.1. Role-negative checks cover every authorized entry point; terminal-state checks exercise every entry point with a fresh revision so rejection cannot be attributed merely to replay. These remain local compiler/runtime assertions, not adversarial network receipts.

## Explicit disclosure inventory

| Item | Boundary |
| --- | --- |
| Constructor `Configuration` | Entirely public: network, nonce, terms/role commitments and all four deadlines. No currency field, terms opening, card/provider ID or secret accepted here. |
| `protocolVersion`, `configuration` | Public ledger; assigned only by constructor. There is no role/configuration replacement circuit. |
| `phase`, `revision` | Public ledger; every transition checks supplied expected revision, rejects exhaustion, changes phase atomically and increments once. |
| `deliveryCommitment`, `evidenceCommitment` | Public ledger. Delivery is nonzero and set once. Dispute evidence can be replaced with the operator's nonzero resolution evidence; previous transaction history is not erased. |
| Every action's `expectedRevision` | Explicitly disclosed public argument. |
| Submit `commitment`; approve `expectedDelivery`; dispute/resolve `evidence` | Explicitly disclosed commitment bytes, not file bytes, URLs, evidence text or openings. |
| Resolve `approveOrder` | Explicitly disclosed Boolean selecting full approval or cancellation. |
| Buyer/merchant/operator witness | Own secret only, private circuit input; chosen proving path sees required witness material. |
| `agreedTerms` | Private witness for reserve, accept and approve; bound to immutable terms hash and schema constraints. Merchant never needs buyer limit. |
| `buyerApprovalLimit` | Private reserve-only witness; self-declared policy relation, not available funds or employer authority. |
| Timeout circuits | Only public state, expected revision and kernel time predicates. No witness is invoked. |
| Circuit return values | State-changing circuits return `[]`; pure hash helpers return only a commitment to the local caller. |

Payment, quality, file availability, manifest byte validation, access control for off-chain records, and recovery are not contract assertions. The caller must validate the immutable three-file manifest before using its commitment. Approval binds that exact submitted commitment; operator approval without any submitted delivery is forbidden.

## State/time policy

Bootstrap is `DEPLOYED` revision zero with empty delivery/evidence; only real buyer `reserve` enters `RESERVED`. `ACCEPTED` is the first mutual acceptance. All canonical transitions are represented, with separate buyer/merchant dispute entry points for their distinct phase permissions. `APPROVED` and `CANCELLED` are terminal. No `DRAFT`/`SETTLED` on-chain state, payment oracle, partial capture or automatic quality decision is introduced.

Reservation does not trust constructor execution: it rechecks protocol version one, deployed phase, revision zero, empty delivery/evidence, nonzero network/nonce/commitments, distinct role commitments and positive strictly ordered deadlines. Constructor and reservation share the same public-configuration validator. A malformed deployment cannot obtain a valid reservation merely by presenting matching buyer/terms openings. Correctly committed non-USD terms are rejected against artifact policy, including with raw-injected configuration.

Normal reserve/accept, submit, approve and resolve predicates are respectively `t < acceptance`, `t < delivery`, `t < review`, `t < resolution`. Permissionless expiry uses `kernel.blockTimeGreaterThan(deadline - 1)` for integer-second `t >= deadline`; positive ordered deadlines make subtraction safe. The tests supply a runtime **block context**, not a contract time witness, and exercise one second before, at and after every boundary. Cancellation/decline and dispute retain the canonical state-based eligibility rather than adding an undocumented deadline guard; a post-deadline dispute may still race a timeout and becomes immediately expirable after resolution deadline. Stale revisions serialize competing state changes.

Timeouts never execute themselves: a funded capable caller must prove and submit. Escalation enters `DISPUTED`, never approval. None of these actions claims to capture, void, refund or settle fiat.

## Public syntax receipts

The exact installed compiler/runtime output is decisive for this slice. Upstream language references used to cross-check kernel predicates and persistent hashing:

- https://docs.midnight.network/compact/data-types/ledger-adt
- https://docs.midnight.network/develop/reference/compact/compact-std-library

Those live pages describe language 0.23/compiler 0.31.0; this package is checked with the pinned **0.31.1** binary, not an inferred latest version. No upstream sample contract is copied. No Firecrawl CLI invocation is claimed by this package's local test evidence.
