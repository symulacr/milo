# Native indexer/prover executable experiment

This is an unprivileged alternative-runtime experiment for the existing local
candidate, not a replacement protocol cohort or evidence that M-01–M-03/R1 pass.
It does not run containers, change `/nix`, install packages, or start services.
Artifact inspection alone does not establish runtime compatibility. Subsequent
[native runs](native-network.md) executed these binaries, matched node/indexer
block 1 and checked prover queue readiness. That is not a completed proof flow.

Run `python3 scripts/setup-native-services.py` (or `--service indexer` /
`--service prover`). Python's standard library downloads only the selected public
OCI layer. Before extraction, it verifies the complete compressed layer's size
and SHA256. Only the exact regular executable member is copied, with its own
size and SHA256 verified; other members, links and rootfs contents are not
installed. Cached archives and executables are reverified on each invocation.
New downloads additionally verify the pinned index and Linux amd64 manifest
bytes and their descriptor chain. Bearer tokens remain in memory, are never
printed, and are removed from cross-host redirects. Downloads are chunked at
1 MiB. All artifacts remain under ignored `.tools/native-midnight`.
Selecting indexer also downloads and verifies the public base configuration at
`.tools/native-midnight/indexer/config.yaml`: 2162 bytes, SHA256
`474cba116a5001910583abe335d9b603843ca85e47a4f2480106b2e6fc535493`, from
the exact upstream revision linked below. Valid cached configuration is reused;
modified or corrupt configuration is replaced only after a verified download.
Keep execution-specific settings in private environment overrides, not this
cached upstream file.

## Immutable artifact receipt

Public Docker Hub tag metadata and registry manifests inspected September 7,
2026. These are the same multi-platform pins as the isolated local candidate.
Every digest below is SHA256. Executable hashes were independently calculated
by streaming the exact layer member, without executing it.

| Identity | Indexer standalone 4.3.3 | Proof server 8.1.0 |
| --- | --- | --- |
| Repository | `midnightntwrk/indexer-standalone` | `midnightntwrk/proof-server` |
| Multi-platform manifest | `03afd079b00bcd229df29a24771439c5e7695c339cd89216d0763ce40731cc4b` | `801bbc0340e9e96f16735f77b523f23c7459e3359842f7c79c2c53f4e994d531` |
| Linux amd64 manifest | `07de7d3b615a95cf0fa693557d69446cb4fce0d52dc6d2182d719b20a61c478e` | `829d02876b346fe773d3d17419a38aadb9fafc6653603afbb3f16672bc122bd4` |
| Image config | `e22afd54ca3afb622e3a0f3440b495f8e768476c15a81f77325f80429f20ff09` | `6e1ffb4a816a751443762ff5e8400852a4a1e38ba764b0a0ec4cc520cddbcdce` |
| Selected compressed layer | `95524495474f7b663e0e464245c6afdfdae4c1a43ef1af9c353fc8b2f8feaba4` | `ab2ba8217f6bfb8aeefd3777c7016bde036f31a92784fa23a0cc4ca833d68f0a` |
| Layer bytes | `24576976` | `26728867` |
| Executable | `79744f23e9f58b6562131c07d938c17cfff0856c8f476745b820a57cf8892fb5` | `0e7c638afff563a382316bb06cf31e4afe327e0ada9fd8f2e9b1ef5b73171e03` |
| Executable bytes | `82917264` | `23986080` |

Selected archive members:

- Indexer: `usr/local/bin/indexer-standalone`.
- Prover: `nix/store/6naj0x3l5n0b4cx722xwasyp597p6z3h-ledger-8.1.0/bin/midnight-proof-server`.

Official metadata: [indexer tag](https://hub.docker.com/v2/repositories/midnightntwrk/indexer-standalone/tags/4.3.3),
[prover tag](https://hub.docker.com/v2/repositories/midnightntwrk/proof-server/tags/8.1.0).
OCI manifests use `https://registry-1.docker.io/v2/midnightntwrk/<image>/manifests/sha256:<digest>`;
config/layer bytes use the same repository's `/blobs/sha256:<digest>` endpoint.
Anonymous pull tokens come from `https://auth.docker.io/token`, scoped only to
the selected public repository's `pull` action.

## Actual indexer initialization contract

The pinned amd64 image labels identify upstream revision
`a89e1d3b3d8daf73a0e7beed9839ee70188e92c4`, version `4.3.3`.
Its [standalone README](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-standalone/README.md),
[configuration](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-standalone/config.yaml),
[startup implementation](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-standalone/src/main.rs),
and [configuration types](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-standalone/src/config.rs)
establish **SQLite storage, SQLite ledger storage and in-memory pub/sub**.
There is no PostgreSQL/Redis service or server password initialization to align.
The earlier candidate's three external backing-service password requirements
are therefore self-imposed, not prerequisites of this pinned standalone runtime.
This receipt does not itself modify the existing Compose candidate.

The [loader](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-common/src/config.rs)
reads `CONFIG_FILE` (otherwise `config.yaml`) and overlays `APP__` environment
variables, nesting on `__`. Retain the full pinned YAML as the base; these are
the execution-specific overrides, not a complete replacement configuration:

- `APP__APPLICATION__NETWORK_ID`: `undeployed`.
- `APP__INFRA__STORAGE__CNN_URL`: private execution-local SQLite file path.
- `APP__INFRA__LEDGER_DB__CNN_URL`: a separate execution-local SQLite file path.
- `APP__INFRA__NODE__URL`, `APP__INFRA__SPO_NODE__URL`: the isolated node's
  `ws://127.0.0.1:<node-port>` endpoint.
- `APP__INFRA__SPO_NODE__BLOCKFROST_ID`: required nonempty string; pinned YAML
  explicitly permits a nonsecret placeholder when not exercising SPO features.
- `APP__INFRA__API__ADDRESS`: `127.0.0.1`.
- `APP__INFRA__API__PORT`: a distinct unused local port (upstream default 8088).
- `APP__INFRA__SECRET`: privately generated 32 random bytes encoded as 64 hex
  characters; not a wallet seed. The [cipher](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-common/src/cipher.rs)
  requires at least 32 decoded bytes and uses the first 32.

SQLite files are created if missing; `infra.run_migrations: true` runs migrations.
Bypass the container entrypoint's `/var/run` sentinel and invoke the ordinary
executable directly. Retain actor/private-state and database isolation together.

```sh
.tools/native-midnight/indexer/indexer-standalone --version
# After privately preparing CONFIG_FILE and execution-local environment:
.tools/native-midnight/indexer/indexer-standalone
```

The pinned [API router](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-api/src/infra/api.rs)
and [v4 routes](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-api/src/infra/api/v4.rs)
provide `http://127.0.0.1:<indexer-port>/live`, `/ready`,
`/api/v4/graphql` (POST) and `ws://127.0.0.1:<indexer-port>/api/v4/graphql/ws`.
`/api/v3` is an explicit alias to v4. Liveness is not caught-up chain evidence.
The pinned [schema](https://github.com/midnightntwrk/midnight-indexer/blob/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-api/graphql/schema-v4.graphql)
defines `Query.block(offset: BlockOffset): Block`, where `BlockOffset` accepts
one height or hash. POST this JSON body to `/api/v4/graphql`:

```json
{"query":"{ block(offset: { height: 1 }) { height hash } }"}
```

Require no GraphQL errors, a nonnull `data.block`, `data.block.height === 1`,
and equality of `data.block.hash` with node JSON-RPC `chain_getBlockHash` using
`params: [1]`, after normalizing optional hex prefixes and case. Validate both
as full 32-byte hex hashes before comparing. This is stronger than `/ready`,
but still not proof/submission evidence.

## Prover loader and bounded next checks

The actual pinned prover ELF is **dynamically linked glibc**, despite the
[ledger-8.1.0 Nix source](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/flake.nix)
describing a musl build target. Do not infer image linking from that source.
Its interpreter is
`/nix/store/jms7zxzm7w1whczwny5m3gkgdjghmi2r-glibc-2.42-51/lib/ld-linux-x86-64.so.2`.
Invoking the already-installed host loader explicitly avoids recreating this
absolute path or modifying the binary:

```sh
/lib64/ld-linux-x86-64.so.2 .tools/native-midnight/prover/midnight-proof-server --help
# Later, only after reviewing the all-interface bind and isolated environment:
MIDNIGHT_PP="$PRIVATE_EXECUTION_DIRECTORY/zk-params" \
  /lib64/ld-linux-x86-64.so.2 \
  .tools/native-midnight/prover/midnight-proof-server --port "$PROOF_PORT"
```

Both actual ELFs need `libgcc_s.so.1`, `libm.so.6`, `libc.so.6` and
`ld-linux-x86-64.so.2`. Indexer uses `/lib64/ld-linux-x86-64.so.2` normally.
Inspected symbol-version strings reach GLIBC 2.38 for indexer and 2.34 for
prover. This sandbox has glibc 2.39 and those library paths. That is evidence
for trying the commands, not proof of ABI or gVisor runtime compatibility.
No native release assets were listed for upstream indexer `v4.3.3` or ledger
`ledger-8.1.0`; extracting the exact pinned image avoids a large source build.

The [prover CLI](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/proof-server/src/main.rs)
defaults to port 6300 and two workers; startup normally fetches parameters and
keys before serving. The [data provider](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/base-crypto/src/data_provider.rs)
uses `MIDNIGHT_PP`, then `XDG_CACHE_HOME`, then `HOME` for its cache and verifies
expected hashes fetched from `https://srs.midnight.network/` by default.
`--no-fetch-params` is not equivalent to successful proof readiness.

The [server](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/proof-server/src/lib.rs)
hardcodes `0.0.0.0`; its CLI offers no listen-address option. A native launch
therefore does **not** preserve Compose's loopback-only publishing restriction.
Review sandbox access before launching; do not publish a Preview for it or use
real private inputs. Local clients use `http://127.0.0.1:<proof-port>`.
The pinned [endpoint source](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.0/proof-server/src/endpoints.rs)
defines GET `/version`, `/ready`, `/proof-versions` and POST `/prove-tx`,
among others. The readiness endpoint is not a successful proof receipt.

Version/help execution, isolated node/indexer block observation and prover queue
readiness have since passed. Real transaction diagnostics and M-02/M-03 rejection
tests remain separate gates. Merely extracting these executables or observing a
healthy queue does not establish successful proving.

## Extractor verification

On September 7, 2026, the script successfully verified both manifest chains,
downloaded and verified both complete selected layers, and extracted both
executables with the hashes above. A second invocation verified cached artifacts
without downloading them again. Isolated fixture checks accepted the exact
regular member and rejected duplicate, missing, corrupt and symlink members,
plus a symlink destination. A wrong expected executable digest was rejected.
The pinned YAML passed a fresh isolated download and network-free cached reuse;
wrong-digest and oversized responses were rejected without replacing the prior
file or leaving temporary files.
No indexer or prover executable was run by these checks.
