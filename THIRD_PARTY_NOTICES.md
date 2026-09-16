# Third-party notices

The root [MIT license](LICENSE) applies to project-original material only. It does
not replace upstream licenses, copyright notices or trademark restrictions.

## Midnight local development configuration

`infra/midnight/compose.yml` is derived from
[`midnightntwrk/midnight-local-dev`'s `standalone.yml`](https://github.com/midnightntwrk/midnight-local-dev/blob/902561ddc27a4b096f19835ab1528f38ace515f1/standalone.yml)
at commit `902561ddc27a4b096f19835ab1528f38ace515f1` and remains **Apache-2.0**.
Its SPDX header is retained. The full upstream license is preserved in
[`docs/licenses/midnight-local-dev-APACHE-2.0.txt`](docs/licenses/midnight-local-dev-APACHE-2.0.txt).
The [source receipt](docs/local-network-candidate.md#source-and-cohort-receipt)
records attribution and Milo's modifications.

## Dependencies and tooling

Installed packages, downloaded compiler/runtime tools and native Midnight services
retain their respective upstream licenses. Their inclusion in setup or a lockfile
does not relicense them under MIT. Preserve applicable upstream notices when
redistributing them; consult the packages' license files and
[native service provenance](docs/native-service-sources.md).
