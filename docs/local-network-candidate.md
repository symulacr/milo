# Isolated local network candidate

**Unexecuted optional Docker candidate only. M-01 and R1 are not complete.** The
[native lane](native-network.md) has separate executed service evidence. This configuration
supports the M-01–M-03 technical gate, not browser, payment or production work.
Canonical requirements remain [Blueprint §6.2](../01-blueprint.md#62-midnight-protocol-cohort)
and [Roadmap](../02-roadmap.md). Preserve compiler artifacts before any sandbox
replacement. Runtime replacement was attempted twice after compiler verification;
the platform refused it with another operation active despite completed sessions
and closed child agents. The blocker was reported; Docker and this network have
not run. See [the execution receipt](../PROTOCOL_VERIFICATION.md).

## Source and cohort receipt

Derived from Midnight Network's Apache-2.0 licensed
[standalone.yml](https://github.com/midnightntwrk/midnight-local-dev/blob/902561ddc27a4b096f19835ab1528f38ace515f1/standalone.yml)
at commit `902561ddc27a4b096f19835ab1528f38ace515f1`.
The upstream [license](https://github.com/midnightntwrk/midnight-local-dev/blob/902561ddc27a4b096f19835ab1528f38ace515f1/LICENSE)
applies to this derived configuration; its [license text is retained locally](licenses/midnight-local-dev-APACHE-2.0.txt).
Changes: immutable image references,
explicit opt-in profile, required isolated project/ports, no fixed container
names, and required external private configuration instead of embedded defaults.
Upstream health checks and the public development block-beneficiary address are
retained. That address is not a seed or private key.

Public Docker Hub tag metadata retrieved September 7, 2026 supplies the
multi-platform manifest digests pinned in `infra/midnight/compose.yml`:

| Image | Tag | Manifest digest |
| --- | --- | --- |
| `midnightntwrk/midnight-node` | `1.0.0` | `sha256:ede01da35e982b6a4b85461ad8492ae2753ef14246fba33c8039b782aa8e39fb` |
| `midnightntwrk/indexer-standalone` | `4.3.3` | `sha256:03afd079b00bcd229df29a24771439c5e7695c339cd89216d0763ce40731cc4b` |
| `midnightntwrk/proof-server` | `8.1.0` | `sha256:801bbc0340e9e96f16735f77b523f23c7459e3359842f7c79c2c53f4e994d531` |

Receipts: [node](https://hub.docker.com/v2/repositories/midnightntwrk/midnight-node/tags/1.0.0),
[indexer](https://hub.docker.com/v2/repositories/midnightntwrk/indexer-standalone/tags/4.3.3),
[prover](https://hub.docker.com/v2/repositories/midnightntwrk/proof-server/tags/8.1.0).
No image has been pulled or inspected here. This local `undeployed` cohort differs
from canonical Preview node `1.0.1` / indexer `4.3.5`; it is not an approved
substitution for Preview or proof of compatibility. Do not independently swap tags.

The upstream npm lock resolves Midnight.js protocol `4.1.1`, Compact runtime
`0.16.0`, Compact JS `2.5.1`, and ledger `8.1.0`. Compiler `0.31.1` remains an
external tool. Its locked testcontainers `12.1.0` requires Node `>=22.22`, despite
the root package claiming `>=22.0.0`. Isolate any upstream npm tooling from Milo's
Bun workspace: testkit `4.1.1` uses dashed wallet SDK `1.1.0`, while upstream
directly uses dashed `1.2.0`, not the canonical no-dash wallet namespace. No blanket
overrides, scope renames or sharing incompatible live wallet objects.

## Proposed disposable test profile

`local-candidate` is an explicit **Compose profile**, not an existing verified
Hoplite preview-data profile. It contains only a node, standalone indexer and
prover. No actor funding, account seed or application fixture is provisioned.
Each execution must use its own project name and three unused host ports.
Compose's default network and containers are project-scoped; all published ports
bind to `127.0.0.1`. There are no host data mounts or explicit shared volumes.
The development node's built-in identities are public: never send real assets,
customer data or production wallet material to this environment.

Before startup, securely provision a mode-0600 environment file at
`.hoplite/artifacts/local-network/<execution-id>.env` (already git-ignored).
Do not overwrite another execution's file or print its contents. Required keys:

- `MILO_LOCAL_PROJECT`: unique lowercase Compose project name for this execution.
- `MILO_LOCAL_NODE_PORT`, `MILO_LOCAL_INDEXER_PORT`, `MILO_LOCAL_PROOF_PORT`:
  three distinct unused host ports.
- `MILO_LOCAL_INDEXER_SECRET`: privately generated 32 random bytes encoded as
  64 hexadecimal characters; never a wallet seed.

**Configuration correction:** inspection of the exact pinned image revision
established SQLite storage/ledger databases and in-memory pub/sub, not external
password-backed services. The three earlier password requirements were
self-imposed and have been removed; see the [source receipt](native-service-sources.md).
The indexer encryption secret remains required and private. Native execution has
its own isolated paths and evidence; it does not prove this Compose profile ran.
The Compose configuration deliberately fails closed when any required value is
missing. Environment values remain visible to the local Docker administrator;
this is not a production secret-management design.

## Exact lifecycle commands (not executed)

Run from the repository root only after the private configuration gate above is
resolved and Docker Engine plus Compose V2 are available. Set `ENV_FILE` to the
private file for this execution; keep the same value for cleanup. The project
name is read from that file by Compose, never inferred from a checkout folder.

```sh
ENV_FILE=".hoplite/artifacts/local-network/${EXECUTION_ID:?Set your execution ID}.env"
test -f "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f infra/midnight/compose.yml --profile local-candidate config --quiet
docker compose --env-file "$ENV_FILE" -f infra/midnight/compose.yml --profile local-candidate pull
docker compose --env-file "$ENV_FILE" -f infra/midnight/compose.yml --profile local-candidate up --detach --wait --wait-timeout 240
docker compose --env-file "$ENV_FILE" -f infra/midnight/compose.yml --profile local-candidate ps
```

`--wait-timeout 240` preserves the upstream harness's startup allowance. Node
readiness checks block 1 before releasing the indexer dependency. Prover TCP and
indexer sentinel checks are only preliminary health signals, not successful
proof/indexing evidence. Never publish expanded `docker compose config` output or
raw container inspection, which can disclose the environment values.

Teardown **only this execution's** project, including anonymous volumes:

```sh
docker compose --env-file "$ENV_FILE" -f infra/midnight/compose.yml --profile local-candidate down --volumes --remove-orphans --timeout 30
```

Do not use global Docker cleanup or upstream fixed-container-name cleanup. Do not
run the upstream funding CLI as a persistent service launcher: its noninteractive
path tears down a network it starts. Any future funding tool must be adapted and
verified against these isolated names/endpoints, not assume upstream discovery
will find them. Keep public genesis seed material in ignored upstream tooling
only; do not copy it into tracked source, fixtures, logs or receipts.

## Evidence still required

- Validate the corrected standalone configuration with Compose
  with the actual Docker runtime; none is verified by this file's existence.
- Pull pinned images and record actual platform/image identities.
- Boot a fresh isolated project and observe node block 1, indexer progress and
  actual prover readiness; exercise scoped teardown/reset.
- Provision isolated disposable actors and verify funding/DUST without exposing
  seed material. No funding or reset profile is implemented here.
- Compile with the canonical compiler, preserve artifact fingerprints, then
  actually prove, submit and observe expected finalized local transitions.
- Execute M-02 vectors and M-03 forbidden-transition/bootstrap/maintenance tests.

Pull, health, funding, proving, submission and observation are all unfinished.
Source inspection and static configuration checks do not close M-01 or R1.
