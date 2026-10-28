# Third-party notices

The root [Apache-2.0 license](LICENSE) applies to project-original material only. It does
not replace upstream licenses, copyright notices or trademark restrictions.

## Midnight local development configuration

`infra/midnight/compose.yml` (tracked) is derived from
[`midnightntwrk/midnight-local-dev`'s `standalone.yml`](https://github.com/midnightntwrk/midnight-local-dev/blob/902561ddc27a4b096f19835ab1528f38ace515f1/standalone.yml)
at commit `902561ddc27a4b096f19835ab1528f38ace515f1` and remains **Apache-2.0**. Its SPDX header
(`# SPDX-License-Identifier: Apache-2.0`) is retained at the top of the tracked file, and the full
upstream Apache-2.0 text is the upstream `LICENSE` at
<https://github.com/midnightntwrk/midnight-local-dev/blob/902561ddc27a4b096f19835ab1528f38ace515f1/LICENSE>.

The local attribution notes `docs/local-network-candidate.md`, `docs/licenses/midnight-local-dev-APACHE-2.0.txt`
and `docs/native-service-sources.md` are **not tracked** (`docs/` is gitignored, `.gitignore:20`);
they exist on disk only and are not carried by a fresh clone. The tracked `infra/midnight/compose.yml`
header records the upstream commit and points at those notes for the local working copy.

## Midnight ledger runtime packages

Three runtime dependencies ship **no `license` field and no `LICENSE` file** in
their published npm tarballs, so an automated licence gate reports them as
`UNKNOWN`. Upstream is **Apache-2.0**; the attribution Apache-2.0 section 4 asks
for is recorded here against the exact tag each version was published from.

| package | version | upstream tag | licence |
|---|---|---|---|
| `@midnight-ntwrk/ledger-v8` | 8.1.3 | `proof-server-8.1.3` | Apache-2.0 |
| `@midnight-ntwrk/onchain-runtime-v3` | 3.1.2 | `onchain-runtime-3.1.2` | Apache-2.0 |
| `@midnight-ntwrk/zkir-v2` | 2.1.1 | `zkir-2.1.1` | Apache-2.0 |

All three come from [`midnightntwrk/midnight-ledger`](https://github.com/midnightntwrk/midnight-ledger),
whose repository licence is Apache-2.0. The `LICENSE` file at each tag above is
byte-identical (11357 bytes, SHA-256
`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`) and is the
canonical Apache-2.0 text at
<https://www.apache.org/licenses/LICENSE-2.0>. No upstream `NOTICE` file exists at
any of the three tags, so there is no additional notice to carry.

Full text: <https://github.com/midnightntwrk/midnight-ledger/blob/zkir-2.1.1/LICENSE>
(the same file at every tag above).

## Dependencies and tooling

Installed packages, downloaded compiler/runtime tools and native Midnight services
retain their respective upstream licenses. Their inclusion in setup or a lockfile
does not relicense them under Apache-2.0. Preserve applicable upstream notices when
redistributing them; consult the packages' license files.
