// Synthetic labels and hashes exercise persistence, never source attestation.
import { createHash } from "node:crypto";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../packages/backend/src/public-constructor.mjs";
export const localProvisioningAuthority = {
  operatorId: "synthetic-local-operator",
  sourceId: "synthetic-local-fixture",
};

export function provisioningFixtures(runId) {
  const fingerprint = "b".repeat(64);
  const now = Date.now();
  const accountId = `synthetic-${runId}`;
  const payloads = [
    {
      kind: "membership",
      value: {
        privySubject: `did:privy:synthetic_${runId}`,
        accountId,
        scopeId: `synthetic-${runId}`,
        role: "buyer",
      },
    },
    {
      kind: "customer",
      value: {
        buyerAccountId: accountId,
        stripeAccountId: "acct_SyntheticLocal",
        stripeCustomerId: `cus_${runId.replaceAll("-", "")}`,
      },
    },
    {
      kind: "quote",
      value: {
        constructorVersion: 1,
        constructorEncoding: CONSTRUCTOR_ENCODING,
        buyerCommitment: "1".repeat(64),
        merchantCommitment: "2".repeat(64),
        operatorCommitment: "3".repeat(64),
        id: `synthetic-${runId}`,
        scopeId: `synthetic-${runId}`,
        version: 3,
        buyerAccountId: accountId,
        amountMinor: 100,
        currency: "USD",
        network: "preprod",
        nonce: createHash("sha256").update(runId).digest("hex"),
        ...Object.fromEntries(
          [
            "termsCommitment",
            "artifactFingerprint",
            "keySetFingerprint",
            "rolesFingerprint",
            "initialStateFingerprint",
            "genesisHash",
          ].map((key) => [key, fingerprint]),
        ),
        acceptanceDeadlineSeconds: Math.floor(now / 1000) + 600,
        deliveryDeadlineSeconds: Math.floor(now / 1000) + 1200,
        reviewDeadlineSeconds: Math.floor(now / 1000) + 1800,
        resolutionDeadlineSeconds: Math.floor(now / 1000) + 2400,
        expiresAt: now + 600_000,
        imagePackPolicy: {
          serviceVersion: 1,
          packQuantity: 1,
          outputCount: 3,
          unitPriceMinor: 100,
        },
      },
    },
  ];
  Object.assign(
    payloads[2].value,
    publicConstructorFingerprints(payloads[2].value),
  );
  return payloads.map((payload) => ({
    requestId: `${runId}-${payload.kind}`,
    provenance: {
      ...localProvisioningAuthority,
      evidenceFingerprint: fingerprint,
    },
    payload,
  }));
}
