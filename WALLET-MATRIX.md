# WALLET-MATRIX.md

Tiers: W0 injected test connector · W1 SDK-backed · W2 real Lace · W3 second wallet.

| cell | W0 | W1 | W2 | evidence |
|---|---|---|---|---|
| not installed | TESTED | TODO | TODO | W0 unit: empty registry discover |
| locked | TODO | TODO | TODO | — |
| wrong network | TESTED | TODO | TODO | W0 unit: mainnet fails closed |
| connect rejected | TODO | TODO | TODO | — |
| connect approved | TESTED | TODO | TODO | W0 unit: status+address via connector |
| address change | TODO | TODO | TODO | — |
| disconnect | TODO | TODO | TODO | — |
| network switch | TODO | TODO | TODO | — |
| reload persisted | TODO | TODO | TODO | — |
| second tab | TODO | TODO | TODO | — |
| sign rejected | TODO | TODO | TODO | — |
| sign approved | TODO | TODO | TODO | — |
| insufficient DUST | TODO | TODO | TODO | — |
| prove timeout | TODO | TODO | TODO | — |
| page close mid-sign | TODO | TODO | TODO | — |

Confirmation: real connector values + signed Preprod tx hash re-queried on indexer. Label "Lace" only when Lace signed.
