import ledgerWasmSha from "milo-wasm-sha256:@midnight-ntwrk/ledger-v8";
import onchainWasmSha from "milo-wasm-sha256:@midnight-ntwrk/onchain-runtime-v3";
import ledgerWasmUrl from "milo-wasm-url:@midnight-ntwrk/ledger-v8";
import onchainWasmUrl from "milo-wasm-url:@midnight-ntwrk/onchain-runtime-v3";
import { initChainWasmFrom } from "./wasm.ts";

/** The two binding packages are imported INSIDE the init functions, never at module
 * scope. `@midnight-ntwrk/onchain-runtime-v3` re-exports compact-runtime, whose
 * `constants.js` runs `MAX_FIELD = ocrt.maxField()` at module evaluation, and that
 * needs `__wbg_set_wasm` to have run first. A module-scope import puts the glue and
 * `constants.js` in the chunk that loads with this module, so `maxField()` runs
 * before any init and throws `Cannot read properties of undefined (reading
 * 'maxField')` — the production crash this file used to cause. */
const onchainBindings = () => import("@midnight-ntwrk/onchain-runtime-v3");
const ledgerBindings = () => import("@midnight-ntwrk/ledger-v8");

const ONCHAIN = (bindings: unknown) => ({
  bindings: bindings as Record<string, unknown>,
  url: onchainWasmUrl,
  glueModule: "midnight_onchain_runtime_wasm",
  sha256: onchainWasmSha,
});

const LEDGER = (bindings: unknown) => ({
  bindings: bindings as Record<string, unknown>,
  url: ledgerWasmUrl,
  glueModule: "midnight_ledger_wasm",
  sha256: ledgerWasmSha,
});

/** The pure circuits (hashTerms, hashCapability) run on the onchain runtime only:
 * 1.4 MB instead of 11.27 MB. The quote form hashes before it ever signs, so it must
 * not pay for the ledger module. */
export async function initPureCircuitsWasm(): Promise<void> {
  return initChainWasmFrom([ONCHAIN(await onchainBindings())]);
}

export async function initChainWasm(): Promise<void> {
  const [onchain, ledger] = await Promise.all([
    onchainBindings(),
    ledgerBindings(),
  ]);
  return initChainWasmFrom([ONCHAIN(onchain), LEDGER(ledger)]);
}
