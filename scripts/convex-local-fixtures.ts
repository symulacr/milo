// Copied into the isolated local project only; never deployed with application functions.

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import { REQUIRED_ENTRYPOINTS } from "../packages/backend/src/admission-policy";
import {
  CONSTRUCTOR_ENCODING,
  publicConstructorFingerprints,
} from "../packages/backend/src/public-constructor.mjs";

export const seed = internalMutationGeneric({
  args: { table: v.string(), document: v.any() },
  handler: async (ctx, { table, document }) => ctx.db.insert(table, document),
});

export const rows = internalQueryGeneric({
  args: { table: v.string() },
  handler: async (ctx, { table }) => ctx.db.query(table).collect(),
});

export const admissionFixture = internalMutationGeneric({
  args: { runId: v.string(), accountId: v.string(), scopeId: v.string() },
  handler: async (ctx, { runId, accountId, scopeId }) => {
    const now = Date.now();
    if (!(await ctx.db.query("admissionTimingPolicies").first())) {
      await ctx.db.insert("admissionTimingPolicies", {
        network: "preprod",
        captureSafetyMarginMs: 1_000,
      });
    }
    const fingerprint = "a".repeat(64);
    const common = {
      constructorVersion: 1 as const,
      constructorEncoding: CONSTRUCTOR_ENCODING,
      buyerCommitment: "1".repeat(64),
      merchantCommitment: "2".repeat(64),
      operatorCommitment: "3".repeat(64),
      network: "preprod",
      nonce: bytesToHex(sha256(runId)),
      termsCommitment: fingerprint,
      artifactFingerprint: fingerprint,
      keySetFingerprint: fingerprint,
      rolesFingerprint: fingerprint,
      initialStateFingerprint: fingerprint,
      genesisHash: fingerprint,
      acceptanceDeadlineSeconds: Math.floor(now / 1000) + 60,
      deliveryDeadlineSeconds: Math.floor(now / 1000) + 120,
      reviewDeadlineSeconds: Math.floor(now / 1000) + 180,
      resolutionDeadlineSeconds: Math.floor(now / 1000) + 240,
    };
    Object.assign(common, publicConstructorFingerprints(common));
    await ctx.db.insert("frozenQuotes", {
      ...common,
      id: runId,
      scopeId,
      version: 1,
      buyerAccountId: accountId,
      amountMinor: 100,
      currency: "USD",
    });
    const authorizationId = await ctx.db.insert("paymentIntents", {
      quoteId: runId,
      quoteVersion: 1,
      buyerAccountId: accountId,
      stripeAccountId: "local-account",
      stripeCustomerId: "local-customer",
      stripePaymentIntentId: runId,
      amountMinor: 100,
      currency: "USD",
      environment: "test",
      network: "preprod",
    });
    await ctx.db.insert("paymentObservations", {
      paymentIntentId: authorizationId,
      authorization: {
        id: authorizationId,
        quoteId: runId,
        quoteVersion: 1,
        buyerAccountId: accountId,
        amountMinor: 100,
        currency: "USD",
        usableFrom: now - 1_000,
        usableUntil: now + 59_000,
        captureBeforeMs: now + 600_000,
        source: "payment-observer",
        status: "authorized",
        providerReceiptFingerprint: fingerprint,
      },
    });
    const inputs = [];
    for (const suffix of ["a", "b"]) {
      const address = runId.replaceAll("-", "") + suffix.repeat(32);
      const observationId = `${runId}-${suffix}`;
      await ctx.db.insert("deploymentObservations", {
        ...common,
        id: observationId,
        quoteId: runId,
        quoteVersion: 1,
        observationVersion: 2,
        source: "chain-observer",
        address,
        phase: "DEPLOYED",
        revision: 0,
        entrypoints: [...REQUIRED_ENTRYPOINTS],
        maintenancePolicy: "locked",
        maintenanceReceiptFingerprint: fingerprint,
        blockHash: fingerprint,
        blockHeight: 1,
        stateFingerprint: fingerprint,
        observedAt: now,
      });
      inputs.push({
        quoteId: runId,
        expectedQuoteVersion: 1,
        observationId,
        authorizationId,
        address,
      });
    }
    return inputs;
  },
});
