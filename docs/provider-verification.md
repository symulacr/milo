# Provider checkpoint — 10 September 2026

Scope: connection diagnostics and backend preparation, **not an admitted order**.
R0; provider/operation acceptance remains 0/6 and 0/14.

| Check | Result |
| --- | --- |
| Unit suite | 128 tests, 705 assertions passed |
| Isolated Midnight SDK suite | 63 tests passed on Node 24.20.0; no new native transaction run |
| Static checks | Root/Convex types, lint, production build, frozen lockfile and plan links passed |
| Public configuration | Built endpoint retrieved through local HTTP; only three allowlisted fields; synthetic server-secret canary absent from build |
| Real Privy UI | SDK initialized with public app ID; email dialog opened and closed without email/OTP submission |
| Lace | Button disabled before consent; actual absent extension reported unavailable, never connected |
| Backend UI | Missing Convex deployment remained explicit; no authenticated records claimed |
| Browser errors | None reported during inspected interactions |
| Independent review | Fixed identity-switch and rejected-token-refresh stale success; added static build config |

Managed Preview could not start because the tool required promotion of an
undiscovered listener and its settings lookup missed the existing repository
configuration. Reported to the platform. A bounded foreground run of
`sh scripts/with-bun.sh scripts/dev.ts` supplied local browser evidence and was
stopped afterward; this is not a managed Preview handoff.

No completed Privy login, hosted Convex JWT/concurrency test, Stripe API request,
real Lace connection, proof/signature, payment or preprod submission occurred.
No disclosed secret or wallet recovery material was imported. Only the supplied
public app ID was used locally. Follow [provider setup](provider-setup.md) before
connecting a real development deployment; sample orders remain independent.
