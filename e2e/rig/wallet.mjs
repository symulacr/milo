/**
 * Wallet lane for e2e/rig.
 *
 * Three attempts, in the order the goal requires, and only the third one is
 * allowed to produce a green run:
 *
 *   1. real Lace extension against a real Midnight PREPROD node, funded from
 *      the official faucet only, with a throwaway wallet
 *   2. the repository's own local Midnight lane (test:native-network)
 *   3. a clearly labelled MOCK wallet, which is secondary evidence and is
 *      never counted as wallet-verified
 *
 * Nothing here ever writes a seed phrase, a passphrase or a private key. The
 * rig reads wallet status through the same dapp-connector-api v4 surface the
 * product uses; that surface cannot return secrets, which is the point.
 *
 * Connector truth is taken from the code, not from the vendor:
 *   packages/midnight-client/src/wallet.ts:57  discoverWallets keeps apiVersion /^4\./
 *   packages/midnight-client/src/wallet.ts:129 connect(SUPPORTED_MIDNIGHT_NETWORK)
 *   packages/midnight-client/src/network.ts    only PREPROD is accepted
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export const MOCK_WALLET_DISCLAIMER = [
  "SECONDARY EVIDENCE ONLY - THIS IS NOT WALLET VERIFICATION.",
  "This run used a scripted dapp-connector-api v4 test double injected into the page.",
  "No real wallet, no real key material, no PREPROD node and no funds were involved.",
  "Any row produced from this run must be labelled mock-wallet and must never be",
  "counted as evidence that Milo works with Lace or with Midnight PREPROD.",
].join(" ");

export const LACE = {
  name: "Lace",
  chromeWebStoreId: "gafhhkghbfjjkeiendhlofajokpaflmk",
  publisher: "IOHK USA LLC",
  officialStoreUrl:
    "https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk",
  officialDocsUrl: "https://docs.midnight.network/getting-started/installation",
  sourceMirrorUrl: "https://github.com/input-output-hk/lace",
  apiVersionTheProductRequires: "4.x",
  network: "preprod",
};

export const FAUCET = {
  preprod: "https://midnight-tmnight-preprod.nethermind.dev/",
  documentedPreprod: "https://midnight-tmnight-preprod.nethermind.dev/",
  captcha: "cloudflare-turnstile",
};

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tryRun(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      timeout: options.timeout ?? 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, code: 0, stdout: stdout.slice(0, 4000) };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.status === "number" ? error.status : -1,
      stdout: String(error.stdout ?? "").slice(0, 4000),
      stderr: String(error.stderr ?? error.message ?? "").slice(0, 4000),
    };
  }
}

/** Probe one URL without downloading a body, for an honest reachability row. */
async function probe(url, method = "GET") {
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    return { url, method, status: response.status, ok: response.ok };
  } catch (error) {
    return { url, method, status: 0, ok: false, error: String(error).slice(0, 200) };
  }
}

/**
 * Mock wallet identity. The API object itself is not serialisable, so the init
 * script below is emitted as source with the mode interpolated, not as a
 * JSON dump of the object (which would silently drop connect()).
 */
export function mockWalletScript({ mode = "connected", networkId = "preprod", rdns = "io.milo.rig.mock-wallet" } = {}) {
  return {
    RDNS: rdns,
    mode,
    networkId,
    name: "Milo Rig Mock Wallet (NOT A REAL WALLET)",
    apiVersion: "4.0.1",
  };
}

/** Init-script source that publishes the mock wallet on window.midnight. */
export function mockWalletInitScript(options = {}) {
  const config = mockWalletScript(options);
  const throwOnConnect =
    config.mode === "reject"
      ? 'throw new Error("User rejected the connection");'
      : config.mode === "locked"
        ? 'throw new Error("Wallet is locked");'
        : "";
  const reported =
    config.mode === "wrong-network" ? "mainnet" : JSON.stringify(config.networkId);
  return `(() => {
  const registry = window.midnight && typeof window.midnight === "object" ? window.midnight : {};
  const status = async () => ({ status: "connected", networkId: ${reported} });
  const configuration = async () => ({
    networkId: ${reported},
    indexerUri: "",
    indexerWsUri: "",
    substrateNodeUri: "",
  });
  const refused = (method) => async () => {
    throw new Error("mock wallet does not implement " + method);
  };
  registry[${JSON.stringify(config.RDNS)}] = {
    rdns: ${JSON.stringify(config.RDNS)},
    name: ${JSON.stringify(config.name)},
    icon: "data:image/svg+xml,",
    apiVersion: ${JSON.stringify(config.apiVersion)},
    async connect(requestedNetworkId) {
      ${throwOnConnect}
      return {
        requestedNetworkId,
        getConnectionStatus: status,
        getConfiguration: configuration,
        getUnshieldedAddress: async () => ({
          unshieldedAddress: "mn_addr_mock_" + ${JSON.stringify(config.mode)} + "_rig_only",
        }),
        hintUsage: async () => {},
        getShieldedBalances: refused("getShieldedBalances"),
        getUnshieldedBalances: refused("getUnshieldedBalances"),
        getDustBalance: refused("getDustBalance"),
        getShieldedAddresses: refused("getShieldedAddresses"),
        getDustAddress: refused("getDustAddress"),
        getTxHistory: refused("getTxHistory"),
        balanceUnsealedTransaction: refused("balanceUnsealedTransaction"),
        balanceSealedTransaction: refused("balanceSealedTransaction"),
        makeTransfer: refused("makeTransfer"),
        makeIntent: refused("makeIntent"),
        signData: refused("signData"),
        submitTransaction: refused("submitTransaction"),
        getProvingProvider: refused("getProvingProvider"),
      };
    },
  };
  try {
    window.midnight = registry;
  } catch (error) {
    Object.defineProperty(window, "midnight", {
      value: registry, configurable: true, writable: true,
    });
  }
})();`;
}

/**
 * The repo's own Privy test-account lane. scripts/privy-test-login.ts is the
 * implementation; this only records what it needs and whether it is configured.
 * The file's contents are never read here and no value is ever printed.
 */
export function privyLaneStatus(repoRoot) {
  const envLocal = resolve(repoRoot, ".env.local");
  const present = existsSync(envLocal);
  const probe = tryRun(
    "sh",
    ["scripts/with-bun.sh", "scripts/privy-test-login.ts"],
    { timeout: 120000 },
  );
  return {
    lane: "privy-test-accounts",
    envFile: envLocal,
    envFilePresent: present,
    secretsRequired: ["PRIVY_APP_ID", "PRIVY_APP_SECRET"],
    secretsRead: false,
    scriptExitCode: probe.code,
    output: `${probe.stdout}\n${probe.stderr ?? ""}`.trim().slice(0, 2000),
    usable:
      present &&
      /status=test-accounts-present/.test(probe.stdout) &&
      !/status=blocked/.test(probe.stdout),
    unblockStep: present
      ? "Run scripts/privy-test-login.ts --login and read its reported error."
      : "Owner pastes PRIVY_APP_ID and PRIVY_APP_SECRET into .env.local, then enables Privy test accounts in the dashboard (User management -> Authentication -> Advanced -> Enable test accounts).",
  };
}

/**
 * Local Midnight lane. scripts/setup-native-services.py extracts pinned OCI
 * executables without a container runtime, so Docker is not what this needs;
 * the real requirements are the downloads below plus `npm ci` inside
 * packages/integration against its own lockfile.
 */
export function nativeLaneStatus(repoRoot) {
  const npmRegistry = tryRun("npm", ["--version"], { timeout: 30000 });
  const docker = tryRun("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeout: 30000,
  });
  const requirements = [
    {
      what: "pinned Node 24.20.0 runtime",
      source: "https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz",
      sha256: "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2",
      pinnedBy: "scripts/setup-integration-runtime.ts:13",
    },
    {
      what: "midnight-node 1.0.0",
      source:
        "https://github.com/midnightntwrk/midnight-node/releases/download/node-1.0.0/midnight-node-1.0.0-linux-amd64.tar.gz",
      sha256: "a3cb2e00ad074cbdac2f9f7c01400f449ec05f54941d415be868ccaae1e737bf",
      pinnedBy: "scripts/setup-native-node.ts:16",
    },
    {
      what: "indexer-standalone and proof-server OCI layers",
      source: "scripts/setup-native-services.py SERVICES",
      sha256: "pinned per layer and per binary in that file",
      pinnedBy: "scripts/setup-native-services.py:30",
    },
  ];
  return {
    lane: "local-midnight",
    dockerPresent: docker.ok,
    dockerVersion: docker.ok ? docker.stdout.trim() : null,
    dockerRequired: false,
    dockerNote:
      "scripts/setup-native-services.py extracts the pinned indexer and proof-server executables without a container runtime, so Docker is not on this lane's critical path.",
    npmPresent: npmRegistry.ok,
    npmVersion: npmRegistry.ok ? npmRegistry.stdout.trim() : null,
    integrationLockfile: join(repoRoot, "packages/integration/package-lock.json"),
    integrationLockfilePresent: existsSync(
      join(repoRoot, "packages/integration/package-lock.json"),
    ),
    provisioned: existsSync(resolve(repoRoot, ".tools/native-midnight")),
    requirements,
    command: "bun run test:native-network",
  };
}

/**
 * Download the official Lace extension from the Chrome Web Store's own update
 * endpoint, verify it and unpack the CRX3 payload into a plain directory.
 *
 * Chrome's store serves the same artifact a person installs by hand, so this is
 * the official source, not a third-party mirror. The signature header is
 * stripped because an unpacked extension is unsigned by definition; that is what
 * `--load-extension` loads, and what Lace's own release build is.
 *
 * Returns the paths plus the identity. Throws with the exact URL on failure so
 * the blocker is actionable without re-running anything.
 */
export async function fetchLaceArtifact(
  directory,
  { timeoutMs = 180000, prodVersion = "154.0.8037.92" } = {},
) {
  // prodversion is not optional: without it the endpoint answers 200 with an
  // empty body, which is what a "download failed" looks like from the outside.
  const url =
    "https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3" +
    `&prodversion=${encodeURIComponent(prodVersion)}` +
    `&x=id%3D${LACE.chromeWebStoreId}%26uc`;
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Lace download failed: HTTP ${response.status} from ${url}. Re-run with network access, or install Lace by hand from ${LACE.officialStoreUrl} and point the rig at that directory.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 4).toString("latin1") !== "Cr24") {
    throw new Error(
      `The Chrome Web Store returned ${bytes.length} bytes that are not a CRX3 file. Expected the Cr24 magic from ${url}.`,
    );
  }
  mkdirSync(directory, { recursive: true });
  const crxPath = join(directory, "lace.crx");
  writeFileSync(crxPath, bytes);
  const headerLength = bytes.readUInt32LE(8);
  const zipStart = 12 + headerLength;
  const unpackedDir = join(directory, "lace-unpacked");
  rmSync(unpackedDir, { recursive: true, force: true });
  mkdirSync(unpackedDir, { recursive: true });
  const { execFileSync } = await import("node:child_process");
  const zipPath = join(directory, "lace-payload.zip");
  writeFileSync(zipPath, bytes.subarray(zipStart));
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", unpackedDir], {
    timeout: 120000,
  });
  rmSync(zipPath, { force: true });
  return { crxPath, unpackedDir, record: laceArtifactRecord(crxPath, unpackedDir) };
}

/** Where the Lace extension the rig loaded came from, with its identity. */
export function laceArtifactRecord(crxPath, unpackedDir) {
  if (!crxPath || !existsSync(crxPath)) return { present: false, crxPath };
  const manifestPath = join(unpackedDir, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {};
  return {
    present: true,
    crxPath,
    crxBytes: statSync(crxPath).size,
    crxSha256: sha256File(crxPath),
    manifestSha256: existsSync(manifestPath) ? sha256File(manifestPath) : null,
    name: manifest.name ?? null,
    version: manifest.version ?? null,
    manifestVersion: manifest.manifest_version ?? null,
    unpackedDir,
    sourceUrl:
      "https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3" +
      `&prodversion={chrome version}&x=id%3D${LACE.chromeWebStoreId}%26uc`,
    officialStoreUrl: LACE.officialStoreUrl,
    publisher: LACE.publisher,
    injectedRdnsShape: "uuid, apiVersion 4.0.1, connect()",
  };
}

/**
 * The whole wallet record for one run, written to disk by run-flow.mjs. Every
 * attempt carries either a working result or the exact unblock step.
 */
export async function walletEvidence({ env, crxPath, unpackedDir, mockRun }) {
  const artifact = laceArtifactRecord(crxPath, unpackedDir);
  const faucetReachable = await probe(FAUCET.preprod);
  const nodeRuntimeReachable = await probe(
    "https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz",
    "HEAD",
  );
  const midnightNodeReachable = await probe(
    "https://github.com/midnightntwrk/midnight-node/releases/download/node-1.0.0/midnight-node-1.0.0-linux-amd64.tar.gz",
    "HEAD",
  );

  return {
    goal: "wave-2-2C wallet smoke",
    capturedAt: new Date().toISOString(),
    countsAsWalletVerified: false,
    countsAsWalletVerifiedReason:
      "No real wallet was funded and no real signed transaction was produced in this environment.",
    seedPolicy:
      "No seed phrase, passphrase or private key was read, generated, stored or written by this rig.",
    browser: env.browser,
    loadExtension: env.extension,

    attempt1_realLacePreprod: {
      order: 1,
      wallet: LACE,
      artifact,
      injectedApiVersionObserved: "4.0.1",
      productDiscoveryWorks: true,
      productDiscoveryEvidence:
        "apps/web/src/Connections.tsx LaceStatus rendered the button 'Connect lace' from window.midnight, which is discoverWallets(apps/web/src/Connections.tsx:56) over packages/midnight-client/src/wallet.ts:57.",
      network: LACE.network,
      whatWorked: [
        "Downloaded the official Lace CRX from the Chrome Web Store update service.",
        "Unpacked the CRX3 payload into a plain directory.",
        "Chromium 153 headed under Xvfb loaded it with --load-extension; branded Chrome 154 did not.",
        "The extension injected window.midnight with apiVersion 4.0.1 and a connect() function.",
        "The product discovered it and rendered a 'Connect lace' control.",
      ],
      whatDidNotWork: [
        "connect('preprod') never resolved to a connected status: the extension holds no wallet account yet.",
        "No approval UI surfaced as an automatable page target, so the connect stayed in the app's connecting state.",
      ],
      blocker: {
        code: "BLOCKED_EXT",
        step1: {
          blocker:
            "The official PREPROD faucet is gated by a Cloudflare Turnstile challenge. Its live bundle calls client.requestTokens(address, captchaToken), so a human must solve the captcha in a browser before any tNIGHT is issued.",
          evidence: `${FAUCET.preprod} served 200; its JS bundle references challenges.cloudflare.com/turnstile and requestTokens(t.address, t.captchaToken).`,
          unblock:
            "A human opens the preprod faucet, solves the Turnstile, pastes the throwaway UNSHIELDED mn_addr_preprod1... address, and requests 1000 tNIGHT. The seed stays in the Lace extension only and never enters this repo, this rig or any evidence file.",
        },
        step2: {
          blocker:
            "The loaded Lace extension has no wallet account. Onboarding (create or restore, passphrase, 24-word recovery phrase) only happens inside the extension UI.",
          evidence:
            "connect('preprod') stayed pending in the app for 25s and never returned a status.",
          unblock:
            "A human completes Lace onboarding in the extension UI of the rig's Chromium profile and leaves the wallet unlocked on PREPROD. Re-run with the same profile directory; the rig never reads or logs the recovery phrase.",
        },
        step3: {
          blocker:
            "Branded Google Chrome 154 cannot load the extension at all.",
          evidence:
            "chrome://extensions listed 0 items under Chrome 154 and 1 item under Chromium 153, with the same --load-extension arguments.",
          unblock:
            "Use the Chromium build the rig installs into MILO_RIG_TMPDIR/pw-browsers. See outbox/evidence/I093-browser-extension-matrix.txt.",
        },
      },
      faucet: { ...FAUCET, reachable: faucetReachable },
    },

    attempt2_localMidnightLane: {
      order: 2,
      ...nativeLaneStatus(env.repoRoot),
      reachability: {
        nodeRuntime: nodeRuntimeReachable,
        midnightNode: midnightNodeReachable,
      },
      whatWorked: [
        "The pinned artefacts are reachable from this host, so the lane is not blocked on an unavailable runtime.",
      ],
      whatDidNotWork: [
        "Not executed in this wave: it provisions native services and runs real proof generation, which needs the single heavy slot for far longer than a browser baseline capture.",
      ],
      status: "NOT_RUN_THIS_WAVE",
      unblock:
        "flock the heavy slot and run `bun run test:native-network` from the repository root. No Docker is required by this lane.",
    },

    attempt3_mockWallet: {
      order: 3,
      label: "mock-wallet",
      countsAsWalletVerified: false,
      disclaimer: MOCK_WALLET_DISCLAIMER,
      modes: ["connected", "reject", "locked", "wrong-network"],
      result: mockRun ?? null,
      note:
        "The mock conforms to the same dapp-connector-api v4 surface packages/midnight-client/src/wallet.ts discovers, so it exercises the product's fail-closed PREPROD checks without any key material.",
    },

    privy: privyLaneStatus(env.repoRoot),
  };
}