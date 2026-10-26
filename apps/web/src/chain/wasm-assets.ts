import ledgerWasmSha from "milo-wasm-sha256:@midnight-ntwrk/ledger-v8";
import onchainWasmSha from "milo-wasm-sha256:@midnight-ntwrk/onchain-runtime-v3";
import ledgerWasmUrl from "milo-wasm-url:@midnight-ntwrk/ledger-v8";
import onchainWasmUrl from "milo-wasm-url:@midnight-ntwrk/onchain-runtime-v3";
import * as ledgerBindings from "@midnight-ntwrk/ledger-v8";
import * as onchainBindings from "@midnight-ntwrk/onchain-runtime-v3";
import { initChainWasmFrom } from "./wasm.ts";

const ONCHAIN = {
  bindings: onchainBindings as unknown as Record<string, unknown>,
  url: onchainWasmUrl,
  glueModule: "midnight_onchain_runtime_wasm",
  sha256: onchainWasmSha,
} as const;

const LEDGER = {
  bindings: ledgerBindings as unknown as Record<string, unknown>,
  url: ledgerWasmUrl,
  glueModule: "midnight_ledger_wasm",
  sha256: ledgerWasmSha,
} as const;

/** The pure circuits (hashTerms, hashCapability) run on the onchain runtime only:
 * 1.4 MB instead of 11.27 MB. The quote form hashes before it ever signs, so it
 * must not pay for the ledger module. */
export function initPureCircuitsWasm(): Promise<void> {
  return initChainWasmFrom([ONCHAIN]);
}

export function initChainWasm(): Promise<void> {
  return initChainWasmFrom([ONCHAIN, LEDGER]);
}
