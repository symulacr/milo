# Contributing

## Set up

```bash
sh scripts/setup.sh          # pinned Bun and the Compact toolchain into .tools/
bun run contract:compile     # generated modules and verifier keys (slow once, cached after)
bun run dev                  # http://localhost:3000
```

Copy `.env.example` to `.env.local`. The landing page and legal pages need no variables.

## Checks, in CI order

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run build
```

The strict unused-symbol pass must also report zero errors:

```bash
sh scripts/with-bun.sh node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters
```

## Rules

- A behaviour change needs a test that fails before it and passes after it.
- Do not remove an assertion to make a change fit. Merge tests into a table instead.
- Do not add the words "escrow", "held in trust" or "guaranteed" to the product or its text. See `docs/adr/0001-authorize-and-capture.md`.
- Keep secrets out of the repository. `.env.example` lists names only.
- Commit subjects are `type: lowercase summary`, up to 72 characters, with a body of `- ` lines.

## Where things live

See `docs/ARCHITECTURE.md`. Security reports go through `SECURITY.md`.
