# Provenance

Most code since commit `7bb46bb` was produced by AI workers and reviewed by a lead agent. This page says how, so a reader can judge what to trust.

## Method

1. A worker reads the code in its own copy of the repository and writes a patch. It never edits the working tree.
2. The lead checks the patch with `patch -p1 --dry-run`, applies it, and runs biome, `tsc`, strict `tsc` (`--noUnusedLocals --noUnusedParameters`), the unit tests, the build and the taste lint.
3. Each behaviour change needs a test that fails before the change and passes after it.
4. A snapshot of the tree is saved before each apply, so any step can be undone.
5. The lead deploys Convex and Vercel only after the checks pass.

## Rounds

| Round | Scope |
|---|---|
| 13 | Coded server errors, sign-in failure messages, one UI error surface |
| 14 | Quote creation fix and a response-schema test over every public function |
| 15 | Audit fixes: payments, identity and invites, chain, web |
| 16 | Key encryption, wasm cache, backend refactor, shipping cache, public page copy |
| 17 | Button pending state, chain overlap, access matrix, contract test speed, CSP report-only |
| 18 | Stripe events, ops digest, CSP receiver, Midnight pins, legal pages |

## Known limits

- Some worker reports overstated results and were corrected by checking the code (for example, an unused error code, and two payment risks that did not exist).
- Hand-written patches made while the shell was unavailable were regenerated with real diffs before use.
- Targets of 4x faster shipping, 4x fewer words and a 4x smaller landing page were not reached.
- Nothing has been audited by a third party.

## Where the evidence is

The audit register is in `docs/audit/REGISTER.md`. Worker reports and patches were kept outside the repository.
