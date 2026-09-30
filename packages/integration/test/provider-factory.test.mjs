import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleProviderFactory,
  assembleProvidersFromSlots,
  buildMidnightProvider,
  buildProofProvider,
  buildWalletProvider,
  classifyMidnightClientError,
  InsufficientDustError,
  isInsufficientDustError,
  isLockedWalletError,
  isRejectedSignatureError,
  isWrongNetworkError,
  LockedWalletError,
  missingProviderSlots,
  rethrowAsMidnightClientError,
  RejectedSignatureError,
  WrongNetworkError,
} from "../../midnight-client/src/provider-factory.ts";
import {
  assertLocalDisposableNetwork,
  assertNetworkGuard,
  assertSupportedNetwork,
  encodeNetworkLabel,
  LOCAL_DISPOSABLE_NETWORK,
  NETWORK_GUARD_ALLOWED,
  NETWORK_GUARD_MODES,
} from "../../midnight-client/src/network.ts";
import {
  MIDNIGHT_CLIENT_ERROR_CODES,
  MidnightClientError,
} from "../../midnight-client/src/errors.ts";

const CONTRACT = "c".repeat(64);

function fakeActor(overrides = {}) {
  return {
    getCoinPublicKey: () => "coin",
    getEncryptionPublicKey: () => "enc",
    submitTx: async () => "0xabc",
    zswapSecretKeys: { z: 1 },
    dustSecretKey: { d: 1 },
    unshieldedKeystore: {
      signData: (payload) => ({ signed: payload }),
    },
    wallet: {
      balanceUnboundTransaction: async () => ({ recipe: true }),
      signRecipe: async (recipe, signer) => {
        signer(new Uint8Array([1]));
        return { signed: recipe };
      },
      finalizeRecipe: async (signed) => ({ finalized: signed }),
    },
    ...overrides,
  };
}

function fakeProof(overrides = {}) {
  return {
    proveTx: async () => ({ proved: true }),
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    guard: "undeployed-only",
    network: "undeployed",
    contractAddress: CONTRACT,
    privateStateProvider: { psp: true },
    publicDataProvider: { pdp: true },
    zkConfigProvider: { zk: true },
    proof: fakeProof(),
    actor: fakeActor(),
    ...overrides,
  };
}

// ── typed error taxonomy ────────────────────────────────────────────────

test("U6 taxonomy: four codes, subclass instanceof base", () => {
  assert.deepEqual([...MIDNIGHT_CLIENT_ERROR_CODES], [
    "REJECTED_SIGNATURE",
    "LOCKED_WALLET",
    "WRONG_NETWORK",
    "INSUFFICIENT_DUST",
  ]);
  for (const err of [
    new RejectedSignatureError(),
    new LockedWalletError(),
    new WrongNetworkError(),
    new InsufficientDustError(),
  ]) {
    assert(err instanceof MidnightClientError);
    assert(err instanceof Error);
  }
});

test("U6 taxonomy: classifiers fold wallet-sdk / Effect shapes", () => {
  assert(
    isInsufficientDustError({
      _tag: "Wallet.InsufficientFunds",
      tokenType: "dust",
    }),
  );
  assert(
    !isInsufficientDustError({
      _tag: "Wallet.InsufficientFunds",
      tokenType: "night",
    }),
  );
  const fiberDust = {
    [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
      _tag: "Fail",
      error: { _tag: "Wallet.InsufficientFunds", tokenType: "dust" },
    },
  };
  assert(isInsufficientDustError(fiberDust));
  assert.equal(classifyMidnightClientError(fiberDust), "INSUFFICIENT_DUST");

  assert(isRejectedSignatureError({ _tag: "Wallet.Sign", message: "no" }));
  assert.equal(
    classifyMidnightClientError({ _tag: "Wallet.Sign" }),
    "REJECTED_SIGNATURE",
  );

  assert(isLockedWalletError(new Error("Wallet is not connected")));
  assert.equal(
    classifyMidnightClientError(new Error("Wallet is not connected")),
    "LOCKED_WALLET",
  );

  assert(
    isWrongNetworkError(
      new Error('Unsupported Midnight network "mainnet". Only PREPROD'),
    ),
  );
  assert.equal(
    classifyMidnightClientError(
      new Error('Unsupported Midnight network "mainnet"'),
    ),
    "WRONG_NETWORK",
  );
  assert.equal(classifyMidnightClientError(new Error("other")), null);
});

test("U6 taxonomy: rethrowAsMidnightClientError wraps matching errors only", () => {
  assert.throws(
    () =>
      rethrowAsMidnightClientError(
        { _tag: "Wallet.InsufficientFunds", tokenType: "dust" },
        "fallback",
      ),
    (err) => err instanceof InsufficientDustError && err.code === "INSUFFICIENT_DUST",
  );
  const original = new Error("weird");
  assert.throws(
    () => rethrowAsMidnightClientError(original, "fallback"),
    (err) => err === original,
  );
});

// ── network guard ───────────────────────────────────────────────────────

test("U6 network guard: compile-time modes have runtime allow-lists", () => {
  assert.deepEqual([...NETWORK_GUARD_MODES], [
    "preprod-only",
    "undeployed-only",
  ]);
  assert([...NETWORK_GUARD_ALLOWED["preprod-only"]].includes("preprod"));
  assert(![...NETWORK_GUARD_ALLOWED["preprod-only"]].includes("undeployed"));
  assert([...NETWORK_GUARD_ALLOWED["undeployed-only"]].includes("undeployed"));
  assert(![...NETWORK_GUARD_ALLOWED["undeployed-only"]].includes("preprod"));
});

test("U6 network guard: preprod-only rejects undeployed and vice versa", () => {
  assert.throws(
    () => assertNetworkGuard("undeployed", "preprod-only"),
    (err) => err instanceof WrongNetworkError && err.code === "WRONG_NETWORK",
  );
  assert.throws(
    () => assertNetworkGuard("preprod", "undeployed-only"),
    (err) => err instanceof WrongNetworkError,
  );
  assert.throws(
    () => assertNetworkGuard("mainnet", "preprod-only"),
    WrongNetworkError,
  );
  // Passing checks do not throw.
  assertNetworkGuard("preprod", "preprod-only");
  assertNetworkGuard("undeployed", "undeployed-only");
  assertSupportedNetwork("preprod");
  assertLocalDisposableNetwork(LOCAL_DISPOSABLE_NETWORK);
  assert.throws(() => assertSupportedNetwork("mainnet"), WrongNetworkError);
});

test("U6 network guard: encodeNetworkLabel refuses unknown ids", () => {
  const label = encodeNetworkLabel("preprod");
  assert.equal(label.length, 32);
  assert.equal(new TextDecoder().decode(label).replace(/\0+$/, ""), "preprod");
  assert.throws(() => encodeNetworkLabel("mainnet"), WrongNetworkError);
});

// ── provider-assembly factory ───────────────────────────────────────────

test("U6 factory: assembles six slots through wallet/proof/submit wrappers", async () => {
  const events = [];
  const assembly = assembleProviderFactory(
    baseInput({
      onEvent: (event, fields) => events.push({ event, ...fields }),
    }),
  );
  assert.equal(assembly.guard, "undeployed-only");
  assert.equal(assembly.network, "undeployed");
  assert.equal(assembly.contractAddress, CONTRACT);
  assert.equal(assembly.providers.privateStateProvider.psp, true);
  assert.equal(assembly.providers.publicDataProvider.pdp, true);
  assert.equal(assembly.providers.zkConfigProvider.zk, true);

  const proved = await assembly.providers.proofProvider.proveTx("x");
  assert.deepEqual(proved, { proved: true });
  assert(events.some((e) => e.event === "prove-start"));
  assert(events.some((e) => e.event === "proof-provider-completed"));

  const balanced = await assembly.providers.walletProvider.balanceTx({});
  assert.equal(balanced.finalized.signed.recipe, true);
  assert(events.some((e) => e.event === "balance-start"));
  assert(events.some((e) => e.event === "balance-completed"));

  const txId = await assembly.providers.midnightProvider.submitTx({});
  assert.equal(txId, "0xabc");
  assert(events.some((e) => e.event === "submitted"));
});

test("U6 factory: wrong network and empty address fail closed", () => {
  assert.throws(
    () =>
      assembleProviderFactory(
        baseInput({ guard: "undeployed-only", network: "preprod" }),
      ),
    WrongNetworkError,
  );
  assert.throws(
    () => assembleProviderFactory(baseInput({ contractAddress: "" })),
    /contract address/i,
  );
});

test("U6 factory: missing slots rejected by structural assembly", () => {
  const missing = missingProviderSlots({ privateStateProvider: {} });
  assert.deepEqual(missing, [
    "publicDataProvider",
    "zkConfigProvider",
    "proofProvider",
    "walletProvider",
    "midnightProvider",
  ]);
  assert.throws(
    () =>
      assembleProvidersFromSlots({
        guard: "preprod-only",
        network: "preprod",
        contractAddress: CONTRACT,
        slots: { privateStateProvider: {} },
      }),
    /incomplete/i,
  );
  const complete = assembleProvidersFromSlots({
    guard: "preprod-only",
    network: "preprod",
    contractAddress: CONTRACT,
    slots: {
      privateStateProvider: {},
      publicDataProvider: {},
      zkConfigProvider: {},
      proofProvider: { proveTx: async () => 1 },
      walletProvider: {
        getCoinPublicKey: () => "a",
        getEncryptionPublicKey: () => "b",
        balanceTx: async () => 1,
      },
      midnightProvider: { submitTx: async () => "0x1" },
    },
  });
  assert.equal(complete.guard, "preprod-only");
});

test("U6 factory: balance/proof/submit failures classify to taxonomy codes", async () => {
  const actor = fakeActor({
    wallet: {
      balanceUnboundTransaction: async () => {
        throw { _tag: "Wallet.InsufficientFunds", tokenType: "dust" };
      },
      signRecipe: async () => {
        throw { _tag: "Wallet.Sign" };
      },
      finalizeRecipe: async () => {
        throw new Error("Wallet is not connected");
      },
    },
  });
  const assembly = assembleProviderFactory(baseInput({ actor }));
  await assert.rejects(
    () => assembly.providers.walletProvider.balanceTx({}),
    (err) => err instanceof InsufficientDustError,
  );

  const signingActor = fakeActor({
    wallet: {
      balanceUnboundTransaction: async () => ({ recipe: true }),
      signRecipe: async () => {
        throw { _tag: "Wallet.Sign" };
      },
      finalizeRecipe: async (s) => s,
    },
  });
  const signing = assembleProviderFactory(baseInput({ actor: signingActor }));
  await assert.rejects(
    () => signing.providers.walletProvider.balanceTx({}),
    (err) => err instanceof RejectedSignatureError,
  );

  const lockedActor = fakeActor({
    wallet: {
      balanceUnboundTransaction: async () => ({ recipe: true }),
      signRecipe: async (r, signer) => {
        signer(1);
        return r;
      },
      finalizeRecipe: async () => {
        throw new Error("Wallet is not connected");
      },
    },
  });
  const locked = assembleProviderFactory(baseInput({ actor: lockedActor }));
  await assert.rejects(
    () => locked.providers.walletProvider.balanceTx({}),
    (err) => err instanceof LockedWalletError,
  );

  const proof = fakeProof({
    proveTx: async () => {
      throw new Error("prover down");
    },
  });
  const failingProof = assembleProviderFactory(baseInput({ proof }));
  await assert.rejects(
    () => failingProof.providers.proofProvider.proveTx(),
    /prover down/,
  );
});

test("U6 factory: beforeSubmit hook runs and submit still emits txId", async () => {
  const seen = [];
  const assembly = assembleProviderFactory(
    baseInput({
      beforeSubmit: async (tx) => {
        seen.push(tx);
      },
      onEvent: (event) => seen.push(event),
    }),
  );
  const txId = await assembly.providers.midnightProvider.submitTx({ t: 1 });
  assert.equal(txId, "0xabc");
  assert.equal(seen[0].t, 1);
  assert(seen.includes("submitted"));
});
