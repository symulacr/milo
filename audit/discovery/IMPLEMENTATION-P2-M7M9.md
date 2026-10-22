# IMPLEMENTATION-P2-M7M9.md

| Field | Value |
|---|---|
| Task | TODO **M7** (auth inventory tests) + **M9** (privacy invariant tests) |
| Stage | mvp |
| Date | 2026-09-30 |
| Repo | `/home/eya/milo/milo-main` |
| Evidence criterion | M7: per route · M9: green |
| Deliverables | `packages/backend/test/auth-inventory.test.ts`, `packages/backend/test/privacy-invariants.test.ts`, this report |

---

## 1. Outcome

M7 and M9 complete:

1. **Auth inventory** — every public Convex query/mutation and every HTTP route has an authorization test. A source scan fails the suite if a new public export is not inventoried.
2. **Privacy invariants as tests** — three groups, all green: no plaintext terms on-chain; no PII/secrets in logs or public projections; authorized file reads only.
3. **Suite** — 36 new tests, 0 fail; full `packages/backend` run 285 pass / 0 fail (1123 expects).

---

## 2. M7 — Auth inventory

### 2.1 Public Convex surface (12 query/mutation + 1 bind)

| Export | Kind | Gate | Test |
|---|---|---|---|
| `auth/session.current` | query | `requirePrivySubject` | anon reject |
| `diagnostics.read` | query | `requirePrivySubject` | anon reject |
| `admission.bind` | mutation | Privy + active buyer membership | anon reject via `admitCanonical` |
| `provisioning.freeze` | mutation | Privy + quote-buyer membership | anon + wrong-role reject |
| `provisioning.requestPayment` | mutation | Privy + quote-buyer membership | anon reject |
| `provisioning.requestObservation` | mutation | Privy + quote-buyer membership | anon reject |
| `paymentMonitoring.status` | query | Privy + buyer or consent owner | anon reject |
| `paymentMonitoring.start` | mutation | Privy + immutable binding | anon reject |
| `paymentMonitoring.stop` | mutation | Privy + consent owner | stranger reject; owner allowed |
| `files.requestUpload` | mutation | Privy + order merchant, phase ACCEPTED | anon + buyer reject |
| `files.attachUpload` | mutation | Privy + merchant + grant owner | anon reject |
| `files.freeze` | mutation | Privy + order merchant | anon reject |

Shared gates: `requirePrivySubject` (`packages/backend/src/privy-identity.ts`) and `requireMembership` (`convex/auth/identity.ts`) — both unit-tested (missing, wrong issuer, revoked).

Internal-only exports (`settlement.*`, `stripe*`, `trustedProvisioning.*`, `files.inspect|resolveRead|serveFile|sweepGrants`, `paymentMonitoring.tick|begin|finish`, `provisioning.begin|finish`, `observationIngest.recordDeployment`) are excluded from public inventory by design.

### 2.2 HTTP routes

| Route | Method | Authorization | Test |
|---|---|---|---|
| `/webhooks/stripe` | POST | HMAC `whsec_` signature, fail-closed 503 if unset | unsigned → 503; bad sig → 400 |
| `/files` | GET | delivery resolve re-auth; 400 missing id; 503 unbound transport; 404 denied | covered |
| `/api/public-config` | GET | public by design, allowlisted fields, GET-only 405 | secret-free body asserted |
| `/debug-hmac` | GET | **none** (debug) | route existence asserted |
| `/debug-verify` | POST | **none** (debug) | route existence asserted |

### 2.3 Completeness

`scanPublicExports()` walks `convex/*.ts` for `queryGeneric|mutationGeneric|actionGeneric|httpActionGeneric` and asserts each is inventoried. A new public export without a row fails M7.

---

## 3. M9 — Privacy invariants

### 3.1 No plaintext terms on-chain

- `order.compact` `Configuration` has `termsCommitment` only — no `unitPrice|total|currency|salt|scopeDigest|rightsDigest|paymentPolicy`.
- Ledger exports hold `phase/revision/deliveryCommitment/evidenceCommitment` — never `Terms` or role secrets.
- Generated `Configuration` type matches.
- `reconstructPublicConstructor` emits commitment fields only.

### 3.2 No PII/secrets in logs

- `byIntentRows` projects `{id,action,state,generation,attempt}` — raw bodies/secrets stripped.
- `publicConfigResponse` re-selects allowlist even if the server object is extended; `Cache-Control: no-store`.
- Stripe customer provisioning errors are redacted to a fixed message (provider payloads never surface).
- Source scan of `convex/` + `packages/backend/src/`: no `console.*` line mixes secret/PII tokens with logging.

### 3.3 Authorized file reads only

- Anonymous and non-member callers cannot authorize a delivery read.
- Strangers and out-of-scope dispute operators refused.
- Buyer/operator reads require the confirmed chain binding; merchant can read own delivery.
- Descriptor is a byte-transport object (`grantId,storageId,sha256,contentType,byteLength`) — never a URL or bearer token.
- Index/order re-checked on every read (`fileIndex` 0–2, exact `orderId`).

---

## 4. Verification

```
bun test packages/backend/test/auth-inventory.test.ts \
         packages/backend/test/privacy-invariants.test.ts
# 36 pass, 0 fail, 104 expects

bun test packages/backend
# 285 pass, 0 fail, 1123 expects (14 files)
```

---

## 5. Residual risks

| ID | Risk | Severity | Note |
|---|---|---|---|
| R-M7-01 | `/debug-hmac` and `/debug-verify` are unauthenticated | medium | Debug helpers leak HMAC prefix/lengths of `STRIPE_WEBHOOK_SECRET` material. Disable or gate before production. |
| R-M7-02 | Handler doubles do not exercise hosted Convex auth/OCC | low | Tests verify policy logic and call-site gates; hosted auth remains a deploy-time concern. |
| R-M9-01 | Log scan is static (console.*) | low | Dynamic log sinks (structured logger, APM) would need a second scanner. |
| R-M9-02 | Terms metadata still visible on-chain (timing, commitments) | accepted | Documented product property (08-midnight-core-audit yellow privacy evidence). |

---

## 6. Cross-refs

- TODO.md M7 / M9 rows
- `packages/backend/test/delivery-policy.test.ts` (B-04 delivery auth)
- `convex/http.test.ts` (webhook signature cases)
- `packages/contract/tests/order.test.ts` (MID-T02 terms/commitment)
- `packages/backend/src/privy-identity.ts`, `convex/auth/identity.ts`
