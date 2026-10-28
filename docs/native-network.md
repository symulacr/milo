# Isolated native local-network lane

This opt-in Linux x86_64 lane runs the existing node 1.0.0 / indexer 4.3.3 /
proof-server 8.1.0 candidate without Docker. It is not a replacement protocol
cohort, persistent browser network, R1 completion or pilot. Canonical acceptance
requirements remain unchanged; only the execution mechanism is different.

The [10 September resource diagnosis](deployment-resources.md) measures the full
deployment before sending it. The observed execution-weight excess intentionally
stops the default transaction command with exit 1; this is not a completed deployment or R1.
The separately opted-in [staged diagnostic](staged-bootstrap.md) instead deploys seven
keys, installs the remaining seven and observes the lock in three bounded transactions.
It remains non-admitted and stops before reservation.

Separate opt-in [maintenance controls](maintenance-audit.md) and [actor-process
recovery](recovery-audit.md) now have successful native receipts. The latter kills
only the actor, not the wallet broker/key coordinator. These bounded experiments
do not close admission, broader recovery, R1/R3 or any complete MID acceptance row.

## Reproduce

From the repository root, after the normal Bun/Compact setup:

```sh
bun run setup:native-network
bun run test:native-network
```

Node comes from the official
[1.0.0 Linux amd64 release](https://github.com/midnightntwrk/midnight-node/releases/tag/node-1.0.0),
archive SHA256 `a3cb2e00ad074cbdac2f9f7c01400f449ec05f54941d415be868ccaae1e737bf`.
The [service source receipt](native-service-sources.md) pins the other executables,
image manifests/layers, indexer configuration and actual API semantics. The
smoke command revalidates its executable/configuration inputs before spawning.
An interrupted node download is replaced only after full checksum verification.

The native node needs its bundled `res` working directory. Each run copies it
into a fresh ignored namespace and removes the container preset's externally
exposed RPC/metrics arguments and fixed development peer key. Node RPC/P2P and
indexer HTTP bind loopback. Upstream's prover hardcodes `0.0.0.0`: it is **not
loopback-bound**. Do not open a Preview/tunnel for it or use customer/private
production inputs. This sandbox-only experiment uses disposable synthetic data;
external access control and trusted proving remain gates for later environments.

Indexer uses separate execution-local SQLite files and a random secret kept in
process memory. Public proving parameters may be cached under ignored `.tools`;
they are not actor state. No Docker daemon, root filesystem, `/nix` installation,
global library change or remote hosted witness processor is used. The existing
host glibc loader executes the exact prover binary; ABI compatibility is bounded
to the tested sandbox, not asserted for arbitrary Linux hosts.

## Evidence and lifecycle

Fresh runs have verified node block 1, indexer GraphQL block 1 with the same hash,
indexer caught-up readiness and prover queue availability. Readiness is not a
transaction proof. `/ready` can precede a particular indexed block; the harness
waits separately and asserts exact identity. Diagnostic receipts and raw logs
stay under `.hoplite/artifacts/native-node/run-*`, never in published proof by
default. Normal exit and SIGINT/SIGTERM terminate and await owned processes;
real interruption regression tests cover both signals. SIGKILL cannot execute
application cleanup; use the platform's process-tree termination when necessary.

The [transaction diagnostic](../packages/integration/README.md) has a separate
Node lockfile/process and explicit owned-genesis/loopback checks. To attempt it:

```sh
npm --prefix packages/integration ci --ignore-scripts --no-audit --no-fund
bun run setup:integration-runtime
.tools/node-runtime/node-v24.20.0-linux-x64/bin/node --test packages/integration/test/*.test.mjs
bun run test:native-node --with-services --transactions
```

The supervisor supplies only endpoints of its own disposable network and records
the diagnostic JSONL privately. It does not expose wallet seeds, serialize private
witnesses or claim immutable admission from a positive policy observation. A
timeout after submission is an unknown outcome, not rejection. This harness is
not a recovery implementation: actors are in-memory and the entire disposable
chain/indexer context must be discarded/reset together, never reused as an order.

The selected Node.js runtime is 24.20.0, not the sandbox's incidental 24.19.0.
Its [publisher checksum](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt) is pinned
for `node-v24.20.0-linux-x64.tar.xz` and verified before local extraction. CI uses
the same planned Node version; Bun and Node test suites run separately because
the isolated generated-runtime loader uses Node's module-hook API.

Docker remains an **unexecuted optional fallback**, explicitly invoked with
`-f infra/midnight/compose.yml`; see [its separate instructions](local-network-candidate.md).
Removing the mandatory root Compose file reflects the working native path, not
a claim that the platform's active-operation reprovisioning failure was repaired.
