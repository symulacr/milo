# OWNER-QUEUE.md

| ID | DECISION | WHY OWNER-ONLY | OPTIONS | IMPACT | BLOCKING |
|---|---|---|---|---|---|
| O-PRIVY-AUTH | accept/reject SIWE login change | product auth policy | A email+test accounts / B SIWE / C local test issuer | D3b D3d E2E | yes for demo E2E |
| O-PRIVY-TEST | enable Privy test accounts | owner Dashboard only | enable / stay off | blocks D3b/D3d/D3e/E2E-01 | yes for demo E2E |
| O-PUSH | push to symulacr/milo | remote write | push / wait | public tip | no |
| O-HOST | public demo hosting | prod deploy | vercel / other | judge URL | no |
| O-LIVE-STRIPE | Stripe live mode | money | stay test | prod payments | yes for PR |
| O-MAINNET | mainnet | funds risk | stay preprod | scope | yes for prod |
| O-RATIFY-STAGE | ratify STAGE-MAP | product policy | ratify / edit | labels | no |
| O1 | acceptance 0/14 vs 14/14 wording | scoring | dual-state / flip | form | no |
| O2 | receipts in git | evidence policy | track / local | audit | no |
| O3 | CI | infra | ship / local | quality | no |
| O5 | reconciliation.ts extract | style | keep / split | code | no |
| F-22 | escalateUnreviewed empty evidence | protected contract | document / owner change | contract | yes for that row |
| F-24 | never-read digests | privacy product | document residual | copy | no |
| M8 | Lace gap acceptance | product | accept gap / require Lace | MVP | no |
