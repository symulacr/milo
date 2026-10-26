# Security

Milo is a research prototype. **Do not use it in production.** Stripe runs in test mode only. Midnight targets Preprod and a disposable local network. No real money has moved.

## Reporting

Report vulnerabilities privately to pajiton@atomicmail.io. Do not open a public issue for an exploitable bug. Include reproduction steps and the affected commit. Expect a first reply within 7 days.

## Scope

- In scope: authentication bypass, access to another user's order, secret leakage, payment or settlement abuse in test mode, webhook forgery or replay, invite token handling.
- Out of scope: mainnet funds, live Stripe, social engineering, denial of service by volume, findings that need a malicious browser extension.

## What is already covered

- A test checks every public Convex function against six kinds of user (`packages/backend/test/auth-inventory.test.ts`).
- Stripe webhooks verify the signature, are stored once, and are reconciled on retry.
- Private order secrets stay in the browser, encrypted with a non-extractable key.
- A Content-Security-Policy runs in report-only mode and reports to the Convex `/csp-report` route. It does not yet block anything.

The full audit register is in `docs/audit/REGISTER.md`.

## Secrets

No secret belongs in the repository. `.env.example` lists names only. If you find a secret in history, report it as above.
