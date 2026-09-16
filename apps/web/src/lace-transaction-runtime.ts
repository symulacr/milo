import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

export const lifecycleOperations = [
  "deploy",
  "reserve",
  "accept",
  "cancelReserved",
  "decline",
  "submitDelivery",
  "approve",
  "disputeBuyer",
  "disputeMerchant",
  "resolve",
  "expireBootstrap",
  "expireReserved",
  "expireUndelivered",
  "escalateUnreviewed",
  "expireDispute",
] as const;

export type TransactionIntent = Readonly<{
  operation: (typeof lifecycleOperations)[number];
  orderId: string;
  quoteId: string;
}>;

export type TransactionAuthorization = TransactionIntent &
  Readonly<{
    id: string;
    network: "preprod";
    walletKey: string;
    transaction: string;
    expiresAt: number;
  }>;

// This adapter is a trust boundary, not a transaction supplied by a UI caller.
// Its authenticated backend must bind canonical bytes to the session, frozen
// quote, operation and wallet, and atomically consume each authorization once.
// Raw bytes, a digest and an operation label do not prove a contract method,
// arguments, actor role or admission. The trusted adapter must verify those.
export interface TransactionAuthority {
  resolve(
    intent: TransactionIntent,
    walletKey: string,
  ): Promise<TransactionAuthorization>;
  consume(id: string, transactionDigest: string): Promise<void>;
}

export type SubmissionOutcome = Readonly<{
  authorizationId: string;
  status:
    | "submitted-unconfirmed"
    | "outcome-unknown"
    | "confirmed"
    | "rejected";
}>;

export interface SubmissionAuthority {
  // Verify sealed semantics against the consumed canonical authorization and
  // durably claim a single submission attempt BEFORE the wallet is invoked.
  begin(id: string, sealedTransaction: string, digest: string): Promise<void>;
  // Authenticated PREPROD chain observations bound to this authorization only;
  // never resend, and never treat wallet acknowledgement as contract admission.
  observe(id: string): Promise<SubmissionOutcome>;
}

export type SubmissionReview = Readonly<{
  authorizationId: string;
  transactionDigest: string;
}>;

export type TransactionReview = TransactionIntent &
  Readonly<{
    authorizationId: string;
    network: "preprod";
    walletKey: string;
    transactionDigest: string;
    expiresAt: number;
    payFees: true;
  }>;

type Wallet = Pick<
  ConnectedAPI,
  | "getConnectionStatus"
  | "getConfiguration"
  | "getShieldedAddresses"
  | "balanceUnsealedTransaction"
  | "submitTransaction"
>;

export class LaceTransactionTransport {
  private revision = 0;
  private busy = false;
  private readonly pending = new WeakMap<
    TransactionReview,
    { authorization: TransactionAuthorization; revision: number }
  >();
  private readonly used = new Set<string>();
  private readonly balanced = new WeakMap<
    { tx: string },
    { authorization: TransactionAuthorization; revision: number; tx: string }
  >();
  private readonly submissions = new WeakMap<
    SubmissionReview,
    { authorization: TransactionAuthorization; revision: number; tx: string }
  >();
  private readonly submissionAttempts = new Set<string>();

  constructor(
    private readonly wallet: Wallet,
    private readonly authority: TransactionAuthority,
    private readonly now: () => number = Date.now,
    private readonly submissionAuthority?: SubmissionAuthority,
  ) {}

  invalidate() {
    ++this.revision;
  }

  private async checkWallet(revision: number, expectedKey?: string) {
    const status = await this.wallet.getConnectionStatus();
    const configuration = await this.wallet.getConfiguration();
    if (
      status.status !== "connected" ||
      status.networkId !== "preprod" ||
      configuration.networkId !== "preprod"
    )
      throw new Error("A connected PREPROD wallet is required.");
    const { shieldedCoinPublicKey } = await this.wallet.getShieldedAddresses();
    if (
      revision !== this.revision ||
      !shieldedCoinPublicKey ||
      (expectedKey !== undefined && expectedKey !== shieldedCoinPublicKey)
    )
      throw new Error("Wallet session changed. Prepare a new review.");
    return shieldedCoinPublicKey;
  }

  private checkExpiry(authorization: TransactionAuthorization) {
    if (
      !Number.isSafeInteger(authorization.expiresAt) ||
      authorization.expiresAt <= this.now()
    )
      throw new Error("Transaction authorization expired.");
  }

  async prepare(intent: TransactionIntent): Promise<TransactionReview> {
    if (
      !lifecycleOperations.includes(intent.operation) ||
      !intent.orderId ||
      !intent.quoteId
    )
      throw new Error(
        "A supported lifecycle operation and frozen quote are required.",
      );
    const request = Object.freeze({
      operation: intent.operation,
      orderId: intent.orderId,
      quoteId: intent.quoteId,
    });
    const revision = this.revision;
    const walletKey = await this.checkWallet(revision);
    const authorization = Object.freeze({
      ...(await this.authority.resolve(request, walletKey)),
    });
    if (
      authorization.operation !== request.operation ||
      authorization.orderId !== request.orderId ||
      authorization.quoteId !== request.quoteId ||
      authorization.network !== "preprod" ||
      authorization.walletKey !== walletKey ||
      !authorization.id ||
      typeof authorization.transaction !== "string" ||
      !authorization.transaction.length ||
      authorization.transaction.length > 8 * 1024 * 1024 ||
      this.used.has(authorization.id)
    )
      throw new Error("Canonical transaction authorization does not match.");
    this.checkExpiry(authorization);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(authorization.transaction),
    );
    await this.checkWallet(revision, walletKey);
    const review: TransactionReview = Object.freeze({
      ...request,
      authorizationId: authorization.id,
      network: "preprod",
      walletKey,
      transactionDigest: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      expiresAt: authorization.expiresAt,
      payFees: true,
    });
    this.pending.set(review, { authorization, revision });
    return review;
  }

  // Invoke only from a separate explicit approval action after showing review.
  // Balancing can sign and spend fees; it is not a read-only SDK operation.
  async balanceAfterConsent(
    review: TransactionReview,
    consent: Readonly<{ approved: boolean; transactionDigest: string }>,
  ): Promise<{ tx: string }> {
    const pending = this.pending.get(review);
    if (!pending || this.busy)
      throw new Error(
        "Unknown transaction review or another request is active.",
      );
    this.pending.delete(review);
    if (
      consent.approved !== true ||
      consent.transactionDigest !== review.transactionDigest
    )
      throw new Error("Explicit consent to this transaction is required.");
    const { authorization, revision } = pending;
    if (this.used.has(authorization.id))
      throw new Error("Authorization was already attempted.");
    this.used.add(authorization.id);
    this.busy = true;
    try {
      this.checkExpiry(authorization);
      await this.checkWallet(revision, authorization.walletKey);
      await this.authority.consume(authorization.id, review.transactionDigest);
      await this.checkWallet(revision, authorization.walletKey);
      this.checkExpiry(authorization);
      const result = await this.wallet.balanceUnsealedTransaction(
        authorization.transaction,
        { payFees: true },
      );
      await this.checkWallet(revision, authorization.walletKey);
      if (typeof result.tx !== "string" || !result.tx)
        throw new Error("Wallet did not return a balanced transaction.");
      const balanced = Object.freeze({ tx: result.tx });
      this.balanced.set(balanced, { authorization, revision, tx: result.tx });
      return balanced;
    } finally {
      // Rejection and uncertain failures require a new server authorization.
      this.busy = false;
    }
  }

  async reviewSubmission(balanced: { tx: string }): Promise<SubmissionReview> {
    const pending = this.balanced.get(balanced);
    if (!pending || !this.submissionAuthority)
      throw new Error(
        "Trusted submission authority and balanced capability required.",
      );
    this.balanced.delete(balanced);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pending.tx),
    );
    const review = Object.freeze({
      authorizationId: pending.authorization.id,
      transactionDigest: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    });
    this.submissions.set(review, pending);
    return review;
  }

  async submitAfterConsent(
    review: SubmissionReview,
    consent: Readonly<{ approved: boolean; transactionDigest: string }>,
  ): Promise<SubmissionOutcome> {
    const pending = this.submissions.get(review);
    if (!pending || !this.submissionAuthority || this.busy)
      throw new Error(
        "Unknown submission or another wallet request is active.",
      );
    this.submissions.delete(review);
    if (
      consent.approved !== true ||
      consent.transactionDigest !== review.transactionDigest
    )
      throw new Error("Explicit submission consent is required.");
    if (this.submissionAttempts.has(review.authorizationId))
      throw new Error("Submission already attempted. Observe; do not resend.");
    this.submissionAttempts.add(review.authorizationId);
    this.busy = true;
    try {
      this.checkExpiry(pending.authorization);
      await this.checkWallet(pending.revision, pending.authorization.walletKey);
      // Even a failed server response may have persisted the attempt claim.
      try {
        await this.submissionAuthority.begin(
          review.authorizationId,
          pending.tx,
          review.transactionDigest,
        );
        await this.checkWallet(
          pending.revision,
          pending.authorization.walletKey,
        );
        this.checkExpiry(pending.authorization);
        await this.wallet.submitTransaction(pending.tx);
        await this.checkWallet(
          pending.revision,
          pending.authorization.walletKey,
        );
        return {
          authorizationId: review.authorizationId,
          status: "submitted-unconfirmed",
        };
      } catch {
        return {
          authorizationId: review.authorizationId,
          status: "outcome-unknown",
        };
      }
    } finally {
      this.busy = false;
    }
  }

  async recoverSubmission(authorizationId: string): Promise<SubmissionOutcome> {
    if (!authorizationId || !this.submissionAuthority)
      throw new Error("Trusted observation authority required.");
    const outcome = await this.submissionAuthority.observe(authorizationId);
    if (
      outcome.authorizationId !== authorizationId ||
      ![
        "submitted-unconfirmed",
        "outcome-unknown",
        "confirmed",
        "rejected",
      ].includes(outcome.status)
    )
      throw new Error("Invalid trusted observation.");
    return Object.freeze({ authorizationId, status: outcome.status });
  }
}
