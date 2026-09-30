# SECURITY-INVENTORY.md (PR2)

## HTTP routes
| Path | Method | Auth | Notes |
|---|---|---|---|
| `/webhooks/stripe` | POST | HMAC signature | test-mode only |
| `/files` | GET | Privy JWT + membership | per-read re-auth |
| `/debug-hmac` | GET | none | RFC vector debug |
| `/debug-verify` | POST | none | HMAC compare debug |

## Convex functions (sample)
| Function | Type | Auth |
|---|---|---|
| admission.bind | mutation | Privy + membership |
| files.* | mutation | membership |
| settlement.* | internal | scheduler |
| paymentMonitoring.* | mutation | Privy |
| provisioning.* | mutation | admin/allowlist |

## Gaps
- `debug-hmac` / `debug-verify` should be removed before production (PR2)
- CSP/headers: `dist/_headers` has some; verify on host
- Rate limits: not implemented (OWNER for prod)
- Dependency audit: dual lockfiles (bun + npm)

## Evidence
E-PR2-01 route grep output
