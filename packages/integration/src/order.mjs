import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

export const artifacts = fileURLToPath(
  new URL("../../contract/generated/", import.meta.url),
);
const runtime = import.meta.resolve("@midnight-ntwrk/compact-runtime");
// Original generated code must share the isolated SDK's WASM runtime identity.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "@midnight-ntwrk/compact-runtime" &&
      context.parentURL?.startsWith(
        new URL("../../contract/generated/", import.meta.url).href,
      )
    ) {
      return { url: runtime, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
export const generated = await import(
  "../../contract/generated/contract/index.js"
);

const required = (value) => {
  if (value === undefined) throw new Error("Unavailable actor-local witness");
  return value;
};
const role =
  (actor) =>
  ({ privateState }) => {
    if (privateState.actor !== actor)
      throw new Error("Other actor witness requested");
    return [privateState, required(privateState.secret)];
  };
export const witnesses = {
  buyerSecret: role("buyer"),
  merchantSecret: role("merchant"),
  operatorSecret: role("operator"),
  agreedTerms: ({ privateState }) => [
    privateState,
    required(privateState.terms),
  ],
  buyerApprovalLimit: ({ privateState }) => [
    privateState,
    required(privateState.limit),
  ],
};

export function freshOrder() {
  const { pureCircuits, Role } = generated;
  const bytes = () => new Uint8Array(randomBytes(32));
  const network = new Uint8Array(32);
  network.set(new TextEncoder().encode("undeployed"));
  const nonce = bytes();
  const buyer = bytes();
  const terms = {
    serviceVersion: 1n,
    packQuantity: 1n,
    outputCount: 3n,
    unitPrice: 36_000n,
    total: 36_000n,
    currency: new TextEncoder().encode("USD"),
    scopeDigest: bytes(),
    rightsDigest: bytes(),
    paymentPolicy: bytes(),
    salt: bytes(),
  };
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    configuration: {
      network,
      orderNonce: nonce,
      termsCommitment: pureCircuits.hashTerms(network, nonce, terms),
      buyerCommitment: pureCircuits.hashCapability(
        network,
        nonce,
        Role.BUYER,
        buyer,
      ),
      merchantCommitment: pureCircuits.hashCapability(
        network,
        nonce,
        Role.MERCHANT,
        bytes(),
      ),
      operatorCommitment: pureCircuits.hashCapability(
        network,
        nonce,
        Role.OPERATOR,
        bytes(),
      ),
      acceptanceDeadline: now + 3600n,
      deliveryDeadline: now + 7200n,
      reviewDeadline: now + 10800n,
      resolutionDeadline: now + 14400n,
    },
    privateState: { actor: "buyer", secret: buyer, terms, limit: 36_000n },
  };
}
