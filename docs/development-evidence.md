# Development source receipt — 7 September 2026

## Native execution follow-up

The standalone CLI was actually retried with
`bun run research:developer 'Midnight local development native node proof server run without Docker' --limit 3 --json`.
It again denied keyless use from this IP and requested an API key. No CLI success
is claimed and no key was borrowed or exposed. The separately authenticated
Firecrawl Developer Index returned official native-proving and local-network
documentation; public web search and exact official release/registry bytes then
established the runnable artifacts.

- [Official local-proving explanation](https://github.com/midnightntwrk/midnight-docs/blob/7fc45d20a81791e914849a6fa4dcd869c068bf53/docs/guides/local-proving.mdx): native binaries are workable, with platform linking/version responsibility. This is not permission to assume ABI compatibility.
- [Official generator release v0.4.4](https://github.com/midnightntwrk/create-mn-app/releases/tag/v0.4.4): corroborates node 1.0.0/indexer 4.3.3/prover 8.1.0 and compiler 0.31.1 for its local example. It does not replace Milo's acceptance gates or silently change the isolated testkit wallet cohort.
- [Native service source receipt](native-service-sources.md): exact image/config/layer/member hashes and startup semantics, verified against actual binaries. The prover's actual ELF is glibc-linked despite source-level musl hints; direct execution, not a search snippet, resolved that distinction.
- [Executed native lane](native-network.md): ordinary unprivileged services run in this sandbox; Docker remains optional and its platform provisioning failure remains unresolved.

This receipt informs implementation choices; it is not compiler, network or customer evidence. The canonical blueprint, roadmap, building guide and Midnight audit remain authoritative for scope and gates.

## Selected toolchain

- [Official support matrix](https://docs.midnight.network/relnotes/support-matrix), retrieved through Firecrawl with a September 7 cache timestamp: Compact devtools **0.5.1**, compiler **0.31.1**, Compact runtime **0.16.0**, on-chain runtime **3.0.0**. Newer compiler 0.34.0 exists, but a higher release number does not establish compatibility with this selected cohort.
- Compiler archive: [official 0.31.1 release](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.31.1), Linux x86_64 SHA-256 `e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb`.
- Devtools archive: [historical official 0.5.1 release](https://github.com/midnightntwrk/compact/releases/tag/compact-v0.5.1), Linux x86_64 SHA-256 `684c6b3d2eef9484aabba7a0820c166ae5c169f3aecf28cbea2074840263ba66`. The old release repository is archived; active compiler development moved to LFDT-Minokawa.
- Installed compiler reports language **0.23.0**, runtime **0.16.0**, ledger target **ledger-8.0.2**. These are separate version namespaces, not a claim that a node or ledger SDK has run.
- A first incremental dependency resolution retained a newer nested on-chain runtime. Resolving both exact direct runtime pins together removed it. `contract:cohort` checks versions, actual resolution paths and WASM class identity; no global overrides are used.

## Firecrawl Developer Index

The user requested the CLI, not merely general web search. [Current CLI documentation](https://docs.firecrawl.dev/sdks/cli) and [Developer Index documentation](https://docs.firecrawl.dev/features/developer) describe keyless developer searches. Public npm metadata reported **firecrawl-cli 1.23.3**; it is pinned as a development dependency, never imported by the application.

```sh
bun run research:developer 'Midnight Compact block-time deadline predicates' --limit 3 --json
```

The real CLI request was attempted. Firecrawl rejected this sandbox's keyless IP as suspicious and required an API key. No CLI credential is configured; no browser login, account creation, key extraction or credential workaround was attempted. This is a **blocked CLI request**, not a successful index lookup.

The separately authenticated Firecrawl `firecrawl_developer_search` integration successfully returned developer-index results for `Midnight Compact compiler kernel blockTimeLessThan blockTimeGreaterThan deadline equality predicate`. Its official historical release-note result describes strict `<` / `>` kernel predicates and standard-library inclusive wrappers. Other results were third-party mirrors and were not treated as authoritative. Historical search hits were checked against the [current ledger ADT reference](https://docs.midnight.network/compact/reference/ledger-adt) and the actual installed compiler/runtime; search ranking alone is not evidence of current behavior.

The chosen timeout boundary is checked in generated-contract tests. No clock witness, latest-version substitution, extra payment oracle, optional sponsorship or new product scope is introduced by this research.
