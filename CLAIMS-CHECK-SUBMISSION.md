# CLAIMS-CHECK-SUBMISSION.md

Each sentence of the submitted AKINDO text against evidence.

| Claim | Evidence | Rung | Verdict |
|---|---|---|---|
| private commissioning workspace | product intent, README | CODE | CONFIRMED |
| one buyer one merchant one 3-image deal | policy: packQuantity=1 outputCount=3 | TESTED | CONFIRMED |
| commercial terms stay immutable / off-chain | terms sealed after reserve; not on ledger plaintext | TESTED | CONFIRMED (word "immutable" ok for terms after reserve) |
| Midnight Compact proves order lifecycle | order.compact 14 circuits | RUNTIME prior + state names | CONFIRMED |
| 14 proof circuits | contract-info / state names | RUNTIME | CONFIRMED |
| capability roles | hashCapability gates | TESTED | CONFIRMED |
| terms sealed after reserve | order.compact | TESTED | CONFIRMED |
| delivery commitment set-once | order.compact | TESTED | CONFIRMED |
| revision fencing | checkRevision | TESTED | CONFIRMED |
| Preprod circuits executed 14/14 | CHANGELOG + state | RUNTIME | CONFIRMED |
| acceptance 0/14 | SPEC/PROTOCOL | — | CONFIRMED (honest dual-state) |
| Stripe signed webhooks | convex/http.ts + endpoint we_1UL7… | TESTED + endpoint | CONFIRMED |
| capture only APPROVED / void only CANCELLED | settlement.ts | TESTED | CONFIRMED |
| digest-bound deliveryCommitment no random | delivery-commitment | TESTED | CONFIRMED |
| attachUpload grant bind | files.ts | TESTED | CONFIRMED |
| observation ingest verdicts | observationIngest | TESTED | CONFIRMED |
| release flags false without receipts | release-flags.mjs | TESTED | CONFIRMED |
| midnight-client Lace v4 + SDK | package | TESTED | CONFIRMED |
| recovery-kit no false usable order | recovery-kit tests | TESTED | CONFIRMED |
| build exit 0 | BASELINE-| RUNTIME local | CONFIRMED |
| unit 485/4/1 | BASELINE-| RUNTIME local | CONFIRMED |
| wallet-signed reserve/accept live | — | NONE | UNSUPPORTED (ongoing) |
| live Stripe capture IDs | — | NONE | UNSUPPORTED (ongoing) |
| full browser E2E video | — | NONE | UNSUPPORTED (ongoing) |

**Repo tip.** Form said b151d52. Tree now has `7d2c6bf` + `b0b79b6`. Update the form link text to "repo tip 7d2c6bf+" or drop the SHA.

**"immutable" vs "off-chain private".** Terms become immutable after reserve. Terms never appear on-chain. Both true. Keep both. Do not say terms are on-chain.

## Counts for form
CONFIRMED 20 · OVERSTATED 0 · UNSUPPORTED 3 (explicit ongoing)
