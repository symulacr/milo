# IMPLEMENTATION-P2-D8-push.md

| Field | Value |
|---|---|
| Task | TODO **D8** — PUSH-READINESS hosting |
| Stage | demo |
| Date | 2026-09-30 |
| Repo | `/home/eya/milo/milo-main` |
| Branch / HEAD | `publish` @ `e5348d7cb1d3e449f2123358f4e5e0e851aaa722` |
| Target remote | `origin` = `https://github.com/symulacr/milo.git` (`symulacr/milo`) |
| Push executed? | **NO** — commands documented only (task constraint) |
| Deliverables | `PUSH-READINESS.md`, this report |

---

## 1. Outcome

D8 complete for the audit/docs surface:

1. Full-history secret scan (path+pattern only) — **no live credentials**; fixtures and detectors classified.
2. Commits ahead of upstream quantified — **24 ahead / 0 behind** of `origin/main`.
3. LFS status — **not configured, not required** at current blob sizes.
4. Exact push commands to `symulacr/milo` written; **not executed**.
5. Hosting checklist for `apps/web`: env vars, `CONVEX_URL` rules, build output, `vercel.json` parity.

---

## 2. Secret scan (full history)

Method: `git rev-list --all` × `git grep -I -E` for each pattern; filename scan via `git log --all --diff-filter=A --name-only`. Output is path+pattern only (values withheld).

### 2.1 High-severity — all CLEAR (EV-D8-15)

`AKIA…` / `ghp_` / `github_pat_` / `sk_live_` / `rk_live_` / `pk_live_` / `-----BEGIN … PRIVATE KEY-----` (PEM, OpenSSH, RSA, EC, PGP) / bare JWT / `scheme://user:pass@` (mongo, postgres, mysql, redis, amqp) / Slack, Google, SendGrid, GitLab, npm, Docker, HuggingFace, Anthropic, OpenAI key shapes.

### 2.2 Path findings (EV-D8-16)

Only `.env.example` was ever added. Live files `.env.local` (1129 B, mode 600) and `.env.preprod` (471 B, mode 600) are on disk and ignored (`.gitignore:33-34`).

### 2.3 Content hits — classified

| Evidence | Path | Pattern | Class |
|---|---|---|---|
| EV-D8-01 | `scripts/gates/gate-selftest.sh` | `sk_test_[A-Za-z0-9]{20,}` | fixture (gate self-test writes a synthetic key to a temp module) |
| EV-D8-02 | `convex/http.test.ts` | `whsec_…`, `sk_test_…` | fixture (unit-test endpoint secrets) |
| EV-D8-03 | `convex/http.ts` | `whsec_` charset + `env("STRIPE_WEBHOOK_SECRET")` | code shape / env lookup |
| EV-D8-04 | `scripts/gates/gate.sh` | `sk_test_`/`whsec_` detector regex | detector (fails product sources that embed those shapes) |
| EV-D8-05 | `WORKLOG.md` | `pi_…` | test-mode PaymentIntent id (D1c); not a key. Optional redact pre-public push |

---

## 3. Commits ahead of upstream

| Item | Value | Evidence |
|---|---|---|
| Branch | `publish` tracking `origin/main` | EV-D8-06 |
| HEAD | `e5348d7` | EV-D8-06 |
| `origin/main` | `7d2c6bf` | EV-D8-06 |
| Ahead / Behind | **24 / 0** | EV-D8-07 |
| Ancestor | `origin/main` is ancestor of HEAD (fast-forward push) | EV-D8-07 |
| Authors | 24× `Symulacr <symulacr@users.noreply.github.com>` | EV-D8-08 |
| Worktree | clean | EV-D8-09 |

Range: `b0b79b6` … `e5348d7` (gates G0–G6, D1a–D1d Stripe/Convex fixes, D2a handoffs). Local `main` (`7ffd9ee`) is not the push tip.

---

## 4. LFS status

| Check | Result | Evidence |
|---|---|---|
| `git-lfs` | absent (command broken/missing) | EV-D8-10 |
| `.gitattributes` | absent | EV-D8-10 |
| Tracked media files | 37 | EV-D8-11 |
| Blobs >1 MB | `studio-cover.png` 2,053,261 B; `demo.gif` 1,464,700 B | EV-D8-12 |
| Total tracked | ~21.2 MB | EV-D8-12 |

No LFS migration needed (GitHub soft per-file limit 50 MB). Revisit only if a single asset approaches that limit.

---

## 5. Push commands to `symulacr/milo` (DO NOT RUN)

```bash
# remote already correct
git remote get-url origin
# → https://github.com/symulacr/milo.git

# pre-flight
git -C /home/eya/milo/milo-main status
git -C /home/eya/milo/milo-main rev-list --count origin/main..HEAD   # 24

# the push (OWNER only)
git -C /home/eya/milo/milo-main push origin publish:main
# optional: also publish the branch name
git -C /home/eya/milo/milo-main push origin publish
```

Expected: `7d2c6bf..e5348d7 publish -> main`. No force-push required.

---

## 6. Hosting checklist — `apps/web`

### 6.1 Env vars

**Browser-safe** (via `GET /api/public-config`, `packages/backend/src/public-config.ts`):

| Var | Rule |
|---|---|
| `PRIVY_APP_ID` | `^[a-zA-Z0-9_-]{1,128}$` or empty |
| `CONVEX_URL` | `https://*.convex.cloud/` only |
| `MIDNIGHT_NETWORK` | must be `preprod` or unset |

**Convex/server only** (never browser):

| Var | Consumer |
|---|---|
| `STRIPE_SECRET_KEY` | `convex/stripeSettlement.ts`, `stripe-*.server.ts` |
| `STRIPE_WEBHOOK_SECRET` | `convex/http.ts` (`whsec_` fail-closed) |
| `STRIPE_ACCOUNT_ID` | `convex/http.ts` (default `"test"`) |
| `PRIVY_APP_ID` | `convex/auth.config.ts` |

### 6.2 `CONVEX_URL`

Validated as HTTPS `*.convex.cloud` with empty path/query/hash/credentials. Frozen into `dist/api/public-config` at build (EV-D8-13). Must be set in Vercel **build** env. Null ⇒ UI copy “Convex is not configured”.

### 6.3 Build output

`bun run build` → `scripts/build.ts` writes `dist/`:

- entry HTML: `index.html`, `app.html`, `public-app.html` (+ per-route `index.html` copies)
- `api/public-config`, `_headers` (`no-store`, `nosniff`)
- `vercel.json`, hashed js/css/images

`dist/` is gitignored (`:25`). Deploy the build product, do not commit it.

### 6.4 `vercel.json` parity

`apps/web/public/vercel.json` ≡ `dist/vercel.json` — **BYTE_IDENTICAL** (EV-D8-14).

Rewrites: `/m/:path+` → `/public-app.html`; `/quotes|/orders|/merchant|/operator /:path+` → `/orders/index.html`. Header: `/api/public-config` ⇒ `Cache-Control: no-store`.

### 6.5 Operator checklist

- [ ] Vercel build = `bun run build` (or equivalent) producing `dist/`
- [ ] Build env: `PRIVY_APP_ID`, `CONVEX_URL`, `MIDNIGHT_NETWORK=preprod`
- [ ] Convex env: `PRIVY_APP_ID`, `STRIPE_WEBHOOK_SECRET`, optional Stripe key/account
- [ ] `vercel.json` parity (5.4)
- [ ] `/api/public-config` GET-only, `no-store`, secrets stripped by `publicConfigResponse`
- [ ] Privy + Convex origin allow-lists include the Vercel domain
- [ ] Stripe webhook → Convex HTTP route with `whsec_` secret
- [ ] No `sk_live_` / seeds in any env visible to the browser build

---

## 7. Residual risk / blockers

| ID | Risk | Mitigation |
|---|---|---|
| RR-D8-01 | Push not executed | OWNER runs §5 after review |
| RR-D8-02 | `pi_…` in `WORKLOG.md` (EV-D8-05) | optional redact; test-mode id only |
| RR-D8-03 | Hosted Convex still unprovisioned (README) | `CONVEX_URL` may be null; not a push blocker |
| RR-D8-04 | Product gates D2a–D7 open | push readiness ≠ demo acceptance |
| RR-D8-05 | `git-lfs` missing on host | irrelevant at current sizes |

---

## 8. Evidence index

| ID | Claim |
|---|---|
| EV-D8-01 | `scripts/gates/gate-selftest.sh` synthetic `sk_test_` fixture |
| EV-D8-02 | `convex/http.test.ts` synthetic `whsec_` fixtures |
| EV-D8-03 | `convex/http.ts` webhook secret via env only |
| EV-D8-04 | `scripts/gates/gate.sh` secret-shape detector |
| EV-D8-05 | `WORKLOG.md` test-mode `pi_…` resource id |
| EV-D8-06 | `publish` @ `e5348d7`, `origin/main` @ `7d2c6bf`, upstream `origin/main` |
| EV-D8-07 | ahead=24, behind=0, FF-able |
| EV-D8-08 | unpushed authors all `Symulacr` |
| EV-D8-09 | clean worktree |
| EV-D8-10 | git-lfs absent; no `.gitattributes` |
| EV-D8-11 | 37 tracked media files |
| EV-D8-12 | two blobs >1 MB; ~21.2 MB total tracked |
| EV-D8-13 | `dist/api/public-config` public JSON shape |
| EV-D8-14 | `vercel.json` byte-identical |
| EV-D8-15 | full-history high-severity patterns CLEAR |
| EV-D8-16 | only `.env.example` ever added; local envs ignored |

---

## 9. Commands run (reproducibility)

```text
git rev-list --all | git cat-file --batch-check  (largest blobs)
git grep -I -l -E -e <pattern> $(git rev-list --all)   # per pattern label
git log --all --pretty=format: --name-only --diff-filter=A | grep -iE '<secret filenames>'
git rev-list --count origin/main..HEAD
git lfs ls-files / command -v git-lfs / ls .gitattributes
cmp -s apps/web/public/vercel.json dist/vercel.json
git status --porcelain
```

Host note: repo lives at WSL path `/home/eya/milo/milo-main`; scripts were executed via `wsl -e bash`.
