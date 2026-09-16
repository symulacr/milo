import { describe, expect, mock, test } from "bun:test";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  LaceTransactionTransport,
  lifecycleOperations,
  type SubmissionOutcome,
  type TransactionAuthorization,
  type TransactionIntent,
  type TransactionReview,
} from "./lace-transaction-runtime";

const intent: TransactionIntent = {
  operation: "reserve",
  orderId: "order-1",
  quoteId: "frozen-quote-1",
};

function fixture(withSubmissionAuthority = true) {
  let network = "preprod";
  let configuredNetwork = "preprod";
  let key = "wallet-key";
  let time = 1;
  const authorization: TransactionAuthorization = {
    ...intent,
    id: "authorization-1",
    network: "preprod",
    walletKey: key,
    transaction: "canonical-proved-unsealed-transaction",
    expiresAt: 100,
  };
  const balance = mock<ConnectedAPI["balanceUnsealedTransaction"]>(
    async () => ({ tx: "sealed-transaction" }),
  );
  const submit = mock<ConnectedAPI["submitTransaction"]>(async () => {});
  const begin = mock(async (_id: string, _tx: string, _digest: string) => {});
  const observe = mock(
    async (authorizationId: string): Promise<SubmissionOutcome> => ({
      authorizationId,
      status: "outcome-unknown",
    }),
  );
  const wallet = {
    getConnectionStatus: async () => ({
      status: "connected" as const,
      networkId: network,
    }),
    getConfiguration: async () => ({
      networkId: configuredNetwork,
      indexerUri: "https://indexer.invalid",
      indexerWsUri: "wss://indexer.invalid",
      substrateNodeUri: "https://node.invalid",
    }),
    getShieldedAddresses: async () => ({
      shieldedAddress: "address",
      shieldedCoinPublicKey: key,
      shieldedEncryptionPublicKey: "encryption-key",
    }),
    balanceUnsealedTransaction: balance,
    submitTransaction: submit,
  } satisfies Pick<
    ConnectedAPI,
    | "getConnectionStatus"
    | "getConfiguration"
    | "getShieldedAddresses"
    | "balanceUnsealedTransaction"
    | "submitTransaction"
  >;
  const resolve = mock(async () => authorization);
  const consume = mock(async (_id: string, _digest: string) => {});
  const transport = new LaceTransactionTransport(
    wallet,
    { resolve, consume },
    () => time,
    withSubmissionAuthority ? { begin, observe } : undefined,
  );
  return {
    transport,
    balance,
    consume,
    resolve,
    authorization,
    submit,
    begin,
    observe,
    setNetwork: (value: string) => {
      network = value;
    },
    setConfiguration: (value: string) => {
      configuredNetwork = value;
    },
    changeAccount: () => {
      key = "other-wallet";
    },
    expire: () => {
      time = 100;
    },
  };
}

function approve(review: TransactionReview) {
  return { approved: true, transactionDigest: review.transactionDigest };
}

describe("authorization-bound Lace transaction transport", () => {
  for (const operation of lifecycleOperations) {
    test(`binds canonical authorization to named operation ${operation}`, async () => {
      const f = fixture();
      f.resolve.mockImplementation(async () => ({
        ...f.authorization,
        operation,
      }));
      const review = await f.transport.prepare({ ...intent, operation });
      expect(review.operation).toBe(operation);
      await f.transport.balanceAfterConsent(review, approve(review));
      expect(f.balance).toHaveBeenCalledTimes(1);
      expect(f.submit).not.toHaveBeenCalled();
    });
  }

  test("submission requires a trusted verifier, not just sealed bytes", async () => {
    const f = fixture(false);
    const review = await f.transport.prepare(intent);
    const balanced = await f.transport.balanceAfterConsent(
      review,
      approve(review),
    );
    await expect(f.transport.reviewSubmission(balanced)).rejects.toThrow(
      "authority",
    );
    await expect(
      f.transport.reviewSubmission({ tx: balanced.tx }),
    ).rejects.toThrow();
    expect(f.submit).not.toHaveBeenCalled();
  });

  test("submission requires new explicit consent and returns no finality claim", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    const balanced = await f.transport.balanceAfterConsent(
      review,
      approve(review),
    );
    await expect(
      f.transport.reviewSubmission({ ...balanced }),
    ).rejects.toThrow();
    const submission = await f.transport.reviewSubmission(balanced);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
    const outcome = await f.transport.submitAfterConsent(submission, {
      approved: true,
      transactionDigest: submission.transactionDigest,
    });
    expect(outcome.status).toBe("submitted-unconfirmed");
    expect(f.begin).toHaveBeenCalledWith(
      review.authorizationId,
      balanced.tx,
      submission.transactionDigest,
    );
    expect(f.submit).toHaveBeenCalledWith(balanced.tx);
    await expect(
      f.transport.submitAfterConsent(submission, {
        approved: true,
        transactionDigest: submission.transactionDigest,
      }),
    ).rejects.toThrow();
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  for (const failure of ["begin", "submit"] as const) {
    test(`${failure} response loss stays unknown and recovery never resends`, async () => {
      const f = fixture();
      const review = await f.transport.prepare(intent);
      const balanced = await f.transport.balanceAfterConsent(
        review,
        approve(review),
      );
      const submission = await f.transport.reviewSubmission(balanced);
      f[failure].mockImplementation(async () => {
        throw new Error("Response lost");
      });
      const outcome = await f.transport.submitAfterConsent(submission, {
        approved: true,
        transactionDigest: submission.transactionDigest,
      });
      expect(outcome.status).toBe("outcome-unknown");
      expect(
        (await f.transport.recoverSubmission(review.authorizationId)).status,
      ).toBe("outcome-unknown");
      f.observe.mockImplementation(async (authorizationId) => ({
        authorizationId,
        status: "confirmed",
      }));
      expect(
        (await f.transport.recoverSubmission(review.authorizationId)).status,
      ).toBe("confirmed");
      expect(f.submit).toHaveBeenCalledTimes(failure === "submit" ? 1 : 0);
      expect(f.begin).toHaveBeenCalledTimes(1);
    });
  }

  test("recovery after a new transport session only reads trusted observations", async () => {
    const f = fixture();
    await f.transport.recoverSubmission("previous-authorization");
    expect(f.observe).toHaveBeenCalledWith("previous-authorization");
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.balance).not.toHaveBeenCalled();
    f.observe.mockImplementation(async () => ({
      authorizationId: "wrong",
      status: "confirmed",
    }));
    await expect(
      f.transport.recoverSubmission("previous-authorization"),
    ).rejects.toThrow("Invalid");
  });

  test("network change during durable submission claim prevents wallet submission", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    const balanced = await f.transport.balanceAfterConsent(
      review,
      approve(review),
    );
    const submission = await f.transport.reviewSubmission(balanced);
    f.begin.mockImplementation(async () => f.setNetwork("mainnet"));
    expect(
      (
        await f.transport.submitAfterConsent(submission, {
          approved: true,
          transactionDigest: submission.transactionDigest,
        })
      ).status,
    ).toBe("outcome-unknown");
    expect(f.submit).not.toHaveBeenCalled();
  });

  test("mismatched submission consent cannot claim or send", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    const balanced = await f.transport.balanceAfterConsent(
      review,
      approve(review),
    );
    const submission = await f.transport.reviewSubmission(balanced);
    await expect(
      f.transport.submitAfterConsent(submission, approve(review)),
    ).rejects.toThrow("consent");
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  test("deployment uses the same canonical authorization gate", async () => {
    const f = fixture();
    f.resolve.mockImplementation(async () => ({
      ...f.authorization,
      operation: "deploy",
    }));
    const review = await f.transport.prepare({
      ...intent,
      operation: "deploy",
    });
    expect(review.operation).toBe("deploy");
    await f.transport.balanceAfterConsent(review, approve(review));
    expect(f.balance).toHaveBeenCalledTimes(1);
  });

  test("concurrent approvals cannot open multiple signing prompts", async () => {
    const f = fixture();
    const first = await f.transport.prepare(intent);
    const second = await f.transport.prepare(intent);
    const signing = f.transport.balanceAfterConsent(first, approve(first));
    await expect(
      f.transport.balanceAfterConsent(second, approve(second)),
    ).rejects.toThrow("active");
    await signing;
    expect(f.balance).toHaveBeenCalledTimes(1);
  });

  test("caller-added transaction bytes never reach the wallet", async () => {
    const f = fixture();
    const review = await f.transport.prepare({
      ...intent,
      transaction: "attacker-transaction",
    } as TransactionIntent);
    expect(f.resolve).toHaveBeenCalledWith(intent, "wallet-key");
    await f.transport.balanceAfterConsent(review, approve(review));
    expect(f.balance).toHaveBeenCalledWith(f.authorization.transaction, {
      payFees: true,
    });
  });

  test("preparation is read-only; approval balances canonical bytes once without submission", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    expect(Object.isFrozen(review)).toBe(true);
    expect(review.payFees).toBe(true);
    expect(review.transactionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(f.balance).not.toHaveBeenCalled();
    expect(f.consume).not.toHaveBeenCalled();
    expect(
      await f.transport.balanceAfterConsent(review, approve(review)),
    ).toEqual({
      tx: "sealed-transaction",
    });
    expect(f.consume).toHaveBeenCalledWith(
      review.authorizationId,
      review.transactionDigest,
    );
    expect(f.balance).toHaveBeenCalledWith(f.authorization.transaction, {
      payFees: true,
    });
    await expect(
      f.transport.balanceAfterConsent(review, approve(review)),
    ).rejects.toThrow();
    expect(f.balance).toHaveBeenCalledTimes(1);
  });

  test("forged reviews and cross-transport capabilities cannot sign", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    for (const transport of [f.transport, fixture().transport]) {
      await expect(
        transport.balanceAfterConsent({ ...review }, approve(review)),
      ).rejects.toThrow();
    }
    expect(f.balance).not.toHaveBeenCalled();
  });

  for (const consent of [
    { approved: false, transactionDigest: "" },
    { approved: true, transactionDigest: "different-transaction" },
  ]) {
    test(`rejects absent or mismatched consent ${JSON.stringify(consent)}`, async () => {
      const f = fixture();
      const review = await f.transport.prepare(intent);
      await expect(
        f.transport.balanceAfterConsent(review, consent),
      ).rejects.toThrow("consent");
      expect(f.balance).not.toHaveBeenCalled();
      expect(f.consume).not.toHaveBeenCalled();
    });
  }

  for (const field of ["network", "configuration"] as const) {
    test(`blocks mainnet ${field} before preparation and after approval`, async () => {
      const f = fixture();
      const change = field === "network" ? f.setNetwork : f.setConfiguration;
      change("mainnet");
      await expect(f.transport.prepare(intent)).rejects.toThrow("PREPROD");
      expect(f.resolve).not.toHaveBeenCalled();
      change("preprod");
      const review = await f.transport.prepare(intent);
      change("mainnet");
      await expect(
        f.transport.balanceAfterConsent(review, approve(review)),
      ).rejects.toThrow("PREPROD");
      expect(f.balance).not.toHaveBeenCalled();
    });
  }

  for (const change of ["changeAccount", "expire", "invalidate"] as const) {
    test(`invalidates review on ${change}`, async () => {
      const f = fixture();
      const review = await f.transport.prepare(intent);
      if (change === "invalidate") f.transport.invalidate();
      else f[change]();
      await expect(
        f.transport.balanceAfterConsent(review, approve(review)),
      ).rejects.toThrow();
      expect(f.balance).not.toHaveBeenCalled();
    });
  }

  for (const mismatch of [
    { operation: "deploy" as const },
    { quoteId: "other-quote" },
    { orderId: "other-order" },
    { walletKey: "other-wallet" },
    { transaction: "" },
  ]) {
    test(`rejects mismatched authorization ${JSON.stringify(mismatch)}`, async () => {
      const f = fixture();
      f.resolve.mockImplementation(async () => ({
        ...f.authorization,
        ...mismatch,
      }));
      await expect(f.transport.prepare(intent)).rejects.toThrow();
      expect(f.balance).not.toHaveBeenCalled();
    });
  }

  test("failed authentication/consumption prevents signing", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    f.consume.mockImplementation(async () => {
      throw new Error("Unauthorized or already consumed");
    });
    await expect(
      f.transport.balanceAfterConsent(review, approve(review)),
    ).rejects.toThrow("Unauthorized");
    expect(f.balance).not.toHaveBeenCalled();
  });

  test("rechecks network after server roundtrip", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    f.consume.mockImplementation(async () => f.setNetwork("mainnet"));
    await expect(
      f.transport.balanceAfterConsent(review, approve(review)),
    ).rejects.toThrow("PREPROD");
    expect(f.balance).not.toHaveBeenCalled();
  });

  test("wallet rejection never automatically retries or reuses authorization", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    const duplicate = await f.transport.prepare(intent);
    f.balance.mockImplementation(async () => {
      throw new Error("User rejected");
    });
    await expect(
      f.transport.balanceAfterConsent(review, approve(review)),
    ).rejects.toThrow("User rejected");
    await expect(
      f.transport.balanceAfterConsent(duplicate, approve(duplicate)),
    ).rejects.toThrow("already attempted");
    await expect(f.transport.prepare(intent)).rejects.toThrow();
    expect(f.balance).toHaveBeenCalledTimes(1);
  });

  test("late wallet response is discarded after invalidation", async () => {
    const f = fixture();
    const review = await f.transport.prepare(intent);
    f.balance.mockImplementation(async () => {
      f.transport.invalidate();
      return { tx: "late-signed-transaction" };
    });
    await expect(
      f.transport.balanceAfterConsent(review, approve(review)),
    ).rejects.toThrow("session changed");
    expect(f.balance).toHaveBeenCalledTimes(1);
  });
});
