import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { ConvexReactClient } from "convex/react";
import { api, type OrderDetail, type QuoteTerms } from "../api";
import type {
  OrderCircuitName,
  OrderPrivateState,
  OrderTerms,
  StagedDeployProgress,
} from "../chain";
import {
  fromHex,
  keyFor,
  type OrderKey,
  randomHex,
  saveKey,
  sha256Hex,
  toHex,
} from "./keys";
import type { OrderAction } from "./stages";

type Convex = Pick<ConvexReactClient, "action" | "mutation" | "query">;
export type Signer = { connected: ConnectedAPI };
export type StepState = "waiting" | "active" | "done" | "failed";
export type Report = (id: string, state: StepState, detail?: string) => void;

const RIGHTS = "milo:rights:commercial-use:v1";
const PAYMENT_POLICY = "milo:payment:stripe-manual-capture:v1";
const PREPROD = (() => {
  const value = new Uint8Array(32);
  value.set(new TextEncoder().encode("preprod"));
  return value;
})();

const chain = () => import("../chain");

/** Start the wasm and runtime load once the user has shown intent to act on-chain. */
export const warmChain = () =>
  chain().then((module) => module.warmOrderChain());

/** The steps each long-running circuit reports, in order. */
export const PLAN: Record<string, readonly (readonly [string, string])[]> = {
  start: [
    ["terms", "Check the terms"],
    ["hold", "Hold the card payment"],
    ["deploy", "Publish the contract"],
    ["attach", "Bind the contract"],
    ["reserve", "Reserve the terms"],
  ],
  submitDelivery: [
    ["upload", "Upload three files"],
    ["lock", "Lock the file digests"],
    ["sign", "Sign the delivery in your wallet"],
  ],
};

const scopeOf = (subject: string, quoteId: string) => `${subject}:${quoteId}`;

const orderTerms = (terms: QuoteTerms): OrderTerms => ({
  serviceVersion: 1n,
  packQuantity: 1n,
  outputCount: 3n,
  unitPrice: BigInt(terms.unitPrice),
  total: BigInt(terms.total),
  currency: new TextEncoder().encode("USD"),
  scopeDigest: fromHex(terms.scopeDigest),
  rightsDigest: fromHex(terms.rightsDigest),
  paymentPolicy: fromHex(terms.paymentPolicy),
  salt: fromHex(terms.salt),
});

const privateStateOf = (
  detail: OrderDetail,
  key: OrderKey,
): OrderPrivateState => ({
  actor: key.actor,
  secret: fromHex(key.secret),
  terms: orderTerms(detail.terms),
  limit: BigInt(detail.terms.total),
});

async function run<T>(
  report: Report,
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  report(id, "active");
  try {
    const value = await task();
    report(id, "done");
    return value;
  } catch (error) {
    report(id, "failed", (error as Error).message);
    throw error;
  }
}

type QuoteForm = {
  title: string;
  brief: string;
  amountUsd: number;
  clientEmail: string;
  /** One nonce per form session, so a resubmit cannot mint a second quote. */
  orderNonce?: string;
};

/**
 * The one quote entry point. A studio that already exists passes its `scopeId`;
 * a first order passes `studioName` and the server creates the studio when the
 * caller has none, so a returning studio never renames itself by accident.
 */
export async function createQuote(
  convex: Convex,
  subject: string,
  studio: { scopeId: string } | { studioName: string },
  form: QuoteForm,
) {
  const { orderCommitments } = await chain();
  const commit = await orderCommitments();
  const nonce = form.orderNonce ?? randomHex();
  const secret = randomHex();
  const cents = String(form.amountUsd * 100);
  const terms: QuoteTerms = {
    unitPrice: cents,
    total: cents,
    scopeDigest: await sha256Hex(`${form.title}\n${form.brief}`),
    rightsDigest: await sha256Hex(RIGHTS),
    paymentPolicy: await sha256Hex(PAYMENT_POLICY),
    salt: randomHex(),
  };
  const signed = {
    ...form,
    orderNonce: nonce,
    merchantCommitment: toHex(
      commit.capability(PREPROD, fromHex(nonce), "merchant", fromHex(secret)),
    ),
    termsCommitment: toHex(
      commit.terms(PREPROD, fromHex(nonce), orderTerms(terms)),
    ),
    terms,
  };
  const result =
    "scopeId" in studio
      ? await convex.action(api.createQuote, { ...signed, ...studio })
      : await convex.action(api.createStudioAndQuote, { ...signed, ...studio });
  saveKey(subject, {
    quoteId: result.quoteId,
    actor: "merchant",
    secret,
    nonce,
  });
  // U-03: the quote was created server-side, so a storage failure here must not
  // look like a failed quote — the studio would retry and make a second one.
  // The quote is returned either way; `keySaved` lets the caller warn.
  return { ...result, keySaved: Boolean(keyFor(subject, result.quoteId)) };
}

async function claimInvite(
  convex: Convex,
  subject: string,
  quoteId: string,
  token: string,
  invite: { network: string; orderNonce: string },
): Promise<OrderKey> {
  const { orderCommitments } = await chain();
  const commit = await orderCommitments();
  // Reuse a key this browser already has for the order: a retry after a lost
  // response must sign with the secret the server committed, not a new one.
  const key: OrderKey = keyFor(subject, quoteId) ?? {
    quoteId,
    actor: "buyer",
    secret: randomHex(),
    nonce: invite.orderNonce,
  };
  const result = await convex.mutation(api.acceptInvite, {
    quoteId,
    token,
    buyerCommitment: toHex(
      commit.capability(
        fromHex(invite.network),
        fromHex(invite.orderNonce),
        "buyer",
        fromHex(key.secret),
      ),
    ),
  });
  if (!result.ok) throw new Error(result.reason);
  // Persist only once the server has committed the matching capability.
  // U-03: a full quota or a private-mode store used to throw here, which turned
  // a successful claim into an exception — the order was claimed and the key
  // that signs for it was never written. Say so instead: the order is real and
  // the user's only remedy is to stop and make a backup immediately.
  if (!saveKey(subject, key))
    throw new Error(
      "The order is yours, but this browser could not store its key (its storage is full or blocked). Open this order in a normal window and do not clear the browser, or the order cannot be signed.",
    );
  return key;
}

const progressText = (progress: StagedDeployProgress) =>
  progress.stage === "confirm"
    ? "Milo checks the contract on the network."
    : `Your wallet signs transaction ${{ deploy: 1, verifiers: 2, lock: 3 }[progress.stage]} of 3.`;

async function startOrder(
  convex: Convex,
  wallet: Signer,
  subject: string,
  detail: OrderDetail,
  key: OrderKey,
  report: Report,
) {
  const { deployOrder, readDeployStatus, callOrder, orderCommitments } =
    await chain();
  const { quoteId } = detail;
  const scope = scopeOf(subject, quoteId);
  const privateState = privateStateOf(detail, key);
  await run(report, "terms", async () => {
    const commit = await orderCommitments();
    const recomputed = toHex(
      commit.terms(
        fromHex(detail.chain.network),
        fromHex(detail.chain.orderNonce),
        orderTerms(detail.terms),
      ),
    );
    const scopeDigest = await sha256Hex(`${detail.title}\n${detail.brief}`);
    if (
      recomputed !== detail.chain.termsCommitment ||
      scopeDigest !== detail.terms.scopeDigest
    )
      throw new Error(
        "The terms do not match their commitment. Do not continue. Contact the studio.",
      );
  });
  // The hold and the deadlines query are independent, so start both now and
  // await them where each is needed. The user pays one latency, not two.
  const deadlinesNow =
    detail.stage === "DEPLOYED" ? null : convex.query(api.order, { quoteId });
  const holdNow =
    detail.stage !== "QUOTE"
      ? null
      : run(report, "hold", async () => {
          const hold = await convex.action(api.holdPayment, { quoteId });
          if (hold.state !== "held")
            throw new Error(
              hold.reason ??
                (hold.state === "needs-card"
                  ? "Live card entry is not available yet."
                  : "The payment hold did not complete. Try again."),
            );
        });
  if (detail.stage !== "QUOTE") report("hold", "done");
  let address = detail.contract?.address ?? "";
  if (detail.stage === "DEPLOYED") {
    report("deploy", "done");
    report("attach", "done");
  } else {
    const deadlines = (await deadlinesNow)?.deadlines;
    // Settle the hold before the throw below: it was started concurrently, so
    // awaiting it here costs nothing, and a rejection can no longer escape as an
    // unhandled rejection when the deadlines read came back empty. A declined
    // card is also the more actionable of the two failures, so it wins.
    await holdNow;
    if (!deadlines)
      throw new Error("The order has no deadlines yet. Reload the order.");
    const deployed = await run(report, "deploy", () =>
      deployOrder({
        connected: wallet.connected,
        privateStateScope: scope,
        privateState,
        resume: readDeployStatus(scope).state !== "none",
        onProgress: (progress) =>
          report("deploy", "active", progressText(progress)),
        configuration: {
          network: fromHex(detail.chain.network),
          orderNonce: fromHex(detail.chain.orderNonce),
          termsCommitment: fromHex(detail.chain.termsCommitment),
          buyerCommitment: fromHex(detail.chain.buyerCommitment ?? ""),
          merchantCommitment: fromHex(detail.chain.merchantCommitment),
          operatorCommitment: fromHex(detail.chain.operatorCommitment),
          acceptanceDeadline: BigInt(deadlines.acceptance),
          deliveryDeadline: BigInt(deadlines.delivery),
          reviewDeadline: BigInt(deadlines.review),
          resolutionDeadline: BigInt(deadlines.resolution),
        },
      }),
    );
    address = deployed.contractAddress;
    await run(report, "attach", async () => {
      const bound = await convex.action(api.attachContract, {
        quoteId,
        address,
      });
      if (!bound.ok) throw new Error(bound.reason);
    });
  }
  await run(report, "reserve", () =>
    callOrder({
      connected: wallet.connected,
      contractAddress: address,
      circuit: "reserve",
      expectedRevision: BigInt(detail.contract?.revision ?? 0),
      privateState,
      privateStateScope: scope,
    }),
  );
  await convex.action(api.refreshOrder, { quoteId });
}

export async function openOrder(
  convex: Convex,
  wallet: Signer,
  subject: string,
  quoteId: string,
  token: string,
  invite: { network: string; orderNonce: string },
  report: Report,
) {
  const key = await claimInvite(convex, subject, quoteId, token, invite);
  const detail = await convex.query(api.order, { quoteId });
  if (!detail) throw new Error("The order did not open. Reload the page.");
  await startOrder(convex, wallet, subject, detail, key, report);
}

export async function sign(
  convex: Convex,
  wallet: Signer,
  subject: string,
  detail: OrderDetail,
  key: OrderKey,
  circuit: OrderCircuitName,
  extra: {
    commitment?: Uint8Array;
    expectedDelivery?: Uint8Array;
    evidence?: Uint8Array;
    approveOrder?: boolean;
    /** The address this session signed in with, if known. */
    expectedAddress?: string;
  } = {},
) {
  if (!detail.contract)
    throw new Error("The order contract is not published yet.");
  const { callOrder } = await chain();
  const result = await callOrder({
    connected: wallet.connected,
    contractAddress: detail.contract.address,
    circuit,
    expectedRevision: BigInt(detail.contract.revision),
    privateState: privateStateOf(detail, key),
    privateStateScope: scopeOf(subject, detail.quoteId),
    ...extra,
  });
  await convex.action(api.refreshOrder, { quoteId: detail.quoteId });
  return result;
}

const evidenceOf = async (text: string) =>
  fromHex(await sha256Hex(text.trim()));

export const evidenceBytes = (hex: string | null | undefined) =>
  typeof hex === "string" && /^[0-9a-f]{64}$/.test(hex) ? fromHex(hex) : null;

/** `resolve` must repeat the disputed digest, so the browser reads it from the chain. */
async function disputedEvidence(wallet: Signer, detail: OrderDetail) {
  const address = detail.contract?.address;
  if (!address) return null;
  const { watchOrderContract } = await chain();
  return new Promise<Uint8Array | null>((resolve) => {
    const stop = watchOrderContract({
      connected: wallet.connected,
      address,
      onState: (state) => {
        stop();
        resolve(evidenceBytes(state.evidenceCommitment));
      },
    });
    setTimeout(() => {
      stop();
      resolve(null);
    }, 15_000);
  });
}

export async function deliver(
  convex: Convex,
  wallet: Signer,
  subject: string,
  detail: OrderDetail,
  key: OrderKey,
  files: File[],
  report: Report,
) {
  const orderId = detail.orderId;
  if (!orderId) throw new Error("The order contract is not bound yet.");
  if (files.length !== 3) throw new Error("Select exactly three files.");
  const uploaded = await run(report, "upload", async () => {
    // The three files are independent: run the request/upload/attach chains
    // together, one round trip of latency instead of three.
    const one = async (file: File) => {
      const contentType = file.type || "application/octet-stream";
      const [grant, sha256] = await Promise.all([
        convex.mutation(api.requestUpload, { orderId }),
        file.arrayBuffer().then(sha256Hex),
      ]);
      const response = await fetch(grant.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!response.ok)
        throw new Error(`${file.name} did not upload. Try again.`);
      const { storageId } = (await response.json()) as { storageId: string };
      await convex.mutation(api.attachUpload, {
        grantId: grant.grantId,
        storageId,
        uploadTicket: grant.uploadTicket,
      });
      return {
        grantId: grant.grantId,
        sha256,
        contentType,
        byteLength: file.size,
      };
    };
    return Promise.all(files.map(one));
  });
  const { manifest } = await run(report, "lock", () =>
    convex.mutation(api.freezeFiles, { orderId, files: uploaded }),
  );
  await run(report, "sign", () =>
    sign(convex, wallet, subject, detail, key, "submitDelivery", {
      commitment: fromHex(manifest),
    }),
  );
}

export type DeliveryReview = {
  files: (OrderDetail["delivery"]["files"][number] & {
    url: string;
    match: boolean;
    digest: string;
  })[];
  manifest: string | null;
};

export async function reviewDelivery(
  convex: Convex,
  detail: OrderDetail,
): Promise<DeliveryReview> {
  const orderId = detail.orderId;
  if (!orderId) return { files: [], manifest: null };
  const files = await Promise.all(
    detail.delivery.files.map(async (file) => {
      const bytes = await convex.action(api.serveFile, {
        orderId,
        fileIndex: file.index,
      });
      const digest = await sha256Hex(bytes);
      return {
        ...file,
        url: URL.createObjectURL(new Blob([bytes], { type: file.contentType })),
        match: digest === file.sha256,
        digest,
      };
    }),
  );
  return {
    files,
    manifest:
      files.length === 3
        ? await sha256Hex(files.map((file) => file.digest).join(""))
        : null,
  };
}

async function operatorKey(
  convex: Convex,
  detail: OrderDetail,
): Promise<OrderKey> {
  const result = await convex.action(api.operatorSecret, {
    quoteId: detail.quoteId,
  });
  if (!("secret" in result)) throw new Error(result.reason);
  return {
    quoteId: detail.quoteId,
    actor: "operator",
    secret: result.secret,
    nonce: detail.chain.orderNonce,
  };
}

export async function runAction(input: {
  readonly convex: Convex;
  readonly wallet: Signer;
  readonly subject: string;
  readonly detail: OrderDetail;
  readonly key: OrderKey | null;
  readonly action: OrderAction;
  readonly note: string;
  readonly files: File[];
  readonly report: Report;
  /** The address this session signed in with, if known. */
  readonly expectedAddress?: string;
}) {
  const {
    convex,
    wallet,
    subject,
    detail,
    key,
    action,
    note,
    files,
    report,
    expectedAddress,
  } = input;
  const { circuit } = action;
  if (circuit === "start" || circuit === "submitDelivery") {
    if (!key) throw new Error("This browser has no key for this order.");
    return circuit === "start"
      ? startOrder(convex, wallet, subject, detail, key, report)
      : deliver(convex, wallet, subject, detail, key, files, report);
  }
  const signing =
    circuit === "resolve" ? await operatorKey(convex, detail) : key;
  if (!signing) throw new Error("This browser has no key for this order.");
  const evidence =
    circuit === "resolve"
      ? ((await disputedEvidence(wallet, detail)) ?? undefined)
      : action.needs === "note"
        ? await evidenceOf(note)
        : undefined;
  if (circuit === "resolve" && !evidence)
    // An escalated order recorded no evidence, so `resolve` can never satisfy
    // its own non-default check. Retrying cannot help; the order has to expire.
    throw new Error(
      "This dispute has no evidence on chain, so it cannot be resolved. Expire it instead.",
    );
  return sign(convex, wallet, subject, detail, signing, circuit, {
    approveOrder: action.approveOrder,
    evidence,
    expectedAddress,
    expectedDelivery:
      action.needs === "delivery" && detail.delivery.manifest
        ? fromHex(detail.delivery.manifest)
        : undefined,
  });
}
