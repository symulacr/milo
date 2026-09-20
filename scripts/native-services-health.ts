import assert from "node:assert/strict";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { ownNativeProcess, stopNativeProcess } from "./native-processes";

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

export type NativeEndpoints = {
  MILO_NODE_URL: string;
  MILO_INDEXER_HTTP_URL: string;
  MILO_INDEXER_WS_URL: string;
  MILO_PROOF_URL: string;
  MILO_RUN_DIR: string;
};

export async function verifyNativeServices(
  directory: string,
  nodePort: number,
  nodeBlockHash: string,
  operation?: (endpoints: NativeEndpoints) => Promise<void>,
) {
  const setup = ownNativeProcess(
    Bun.spawn(["python3", "scripts/setup-native-services.py"], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  assert.equal(
    await setup.exited,
    0,
    "Native service identity verification failed",
  );
  const indexerPort = await unusedPort();
  const proverPort = await unusedPort();
  assert.notEqual(indexerPort, proverPort);
  const environment = { PATH: process.env.PATH, HOME: resolve(directory) };
  const processes: Bun.Subprocess[] = [];
  try {
    processes.push(
      ownNativeProcess(
        Bun.spawn(
          [resolve(".tools/native-midnight/indexer/indexer-standalone")],
          {
            cwd: resolve(directory),
            env: {
              ...environment,
              CONFIG_FILE: resolve(
                ".tools/native-midnight/indexer/config.yaml",
              ),
              APP__APPLICATION__NETWORK_ID: "undeployed",
              APP__INFRA__STORAGE__CNN_URL: resolve(
                `${directory}/indexer.sqlite`,
              ),
              APP__INFRA__LEDGER_DB__CNN_URL: resolve(
                `${directory}/ledger.sqlite`,
              ),
              APP__INFRA__NODE__URL: `ws://127.0.0.1:${nodePort}`,
              APP__INFRA__SPO_NODE__URL: `ws://127.0.0.1:${nodePort}`,
              APP__INFRA__SPO_NODE__BLOCKFROST_ID: "local-synthetic-test",
              APP__INFRA__API__ADDRESS: "127.0.0.1",
              APP__INFRA__API__PORT: String(indexerPort),
              APP__INFRA__SECRET: Buffer.from(
                crypto.getRandomValues(new Uint8Array(32)),
              ).toString("hex"),
            },
            stdout: Bun.file(resolve(`${directory}/indexer.stdout.log`)),
            stderr: Bun.file(resolve(`${directory}/indexer.stderr.log`)),
          },
        ),
      ),
    );
    // This upstream executable binds all sandbox interfaces; never publish a Preview for it.
    processes.push(
      ownNativeProcess(
        Bun.spawn(
          [
            "/lib64/ld-linux-x86-64.so.2",
            resolve(".tools/native-midnight/prover/midnight-proof-server"),
            "--port",
            String(proverPort),
            "--num-workers",
            "1",
          ],
          {
            cwd: resolve(directory),
            env: {
              ...environment,
              MIDNIGHT_PP: resolve(".tools/native-midnight/params"),
            },
            stdout: Bun.file(resolve(`${directory}/prover.stdout.log`)),
            stderr: Bun.file(resolve(`${directory}/prover.stderr.log`)),
          },
        ),
      ),
    );
    for (const [name, port] of [
      ["indexer", indexerPort],
      ["prover", proverPort],
    ] as const) {
      let ready = false;
      const deadline = Date.now() + 240_000;
      while (
        Date.now() < deadline &&
        processes.every((p) => p.exitCode === null)
      ) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/ready`, {
            signal: AbortSignal.timeout(2000),
          });
          if (
            response.ok &&
            (name === "indexer" || (await response.json()).status === "ok")
          ) {
            ready = true;
            break;
          }
        } catch {
          /* Startup and parameter downloads may still be in progress. */
        }
        await Bun.sleep(1000);
      }
      assert(
        ready,
        `${name} not ready; inspect private logs under ${directory}`,
      );
    }
    let block: { height: number; hash: string } | null = null;
    const observationDeadline = Date.now() + 120_000;
    while (
      Date.now() < observationDeadline &&
      processes.every((p) => p.exitCode === null)
    ) {
      const indexedResponse = await fetch(
        `http://127.0.0.1:${indexerPort}/api/v4/graphql`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: "query { block(offset: {height: 1}) { height hash } }",
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      assert(indexedResponse.ok);
      const indexed = await indexedResponse.json();
      assert.equal(indexed.errors, undefined);
      block = indexed.data?.block ?? null;
      if (block) break;
      // Readiness allows a small lag; require the actual indexed block separately.
      await Bun.sleep(1000);
    }
    assert(block, "Block 1 was not indexed before the observation deadline");
    assert.equal(block.height, 1);
    const normalize = (hash: string) => hash.toLowerCase().replace(/^0x/, "");
    assert.equal(normalize(block.hash), normalize(nodeBlockHash));
    await operation?.({
      MILO_NODE_URL: `ws://127.0.0.1:${nodePort}`,
      MILO_INDEXER_HTTP_URL: `http://127.0.0.1:${indexerPort}/api/v4/graphql`,
      MILO_INDEXER_WS_URL: `ws://127.0.0.1:${indexerPort}/api/v4/graphql/ws`,
      MILO_PROOF_URL: `http://127.0.0.1:${proverPort}`,
      MILO_RUN_DIR: resolve(directory),
    });
    return {
      indexerReady: true,
      proverReady: true,
      indexedBlockOneMatchesNode: true,
      transactionProven: false,
    };
  } finally {
    for (const process of processes.reverse()) {
      await stopNativeProcess(process);
    }
  }
}
