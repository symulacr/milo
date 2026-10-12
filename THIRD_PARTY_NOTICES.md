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

## Dependencies and tooling

Installed packages, downloaded compiler/runtime tools and native Midnight services
retain their respective upstream licenses. Their inclusion in setup or a lockfile
does not relicense them under Apache-2.0. Preserve applicable upstream notices when
redistributing them; consult the packages' license files.
