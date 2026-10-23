import { HEX64 } from "./encoding.ts";
import {
  type PublicConstructorInputs,
  validPublicConstructor,
} from "./public-constructor.ts";

export const REQUIRED_ENTRYPOINTS = [
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

export interface FrozenQuote extends PublicConstructorInputs {
  id: string;
  network: string;
  nonce: string;
  version: number;
  amountMinor: number;
  currency: string;
  termsCommitment: string;
  buyerAccountId: string;
  artifactFingerprint: string;
  keySetFingerprint: string;
  rolesFingerprint: string;
  initialStateFingerprint: string;
  genesisHash: string;
  acceptanceDeadlineSeconds: number;
  deliveryDeadlineSeconds: number;
  reviewDeadlineSeconds: number;
  resolutionDeadlineSeconds: number;
}
export interface PaymentAuthorization {
  id: string;
  quoteId: string;
  quoteVersion: number;
  buyerAccountId: string;
  amountMinor: number;
  currency: string;
  usableFrom: number;
  usableUntil: number;
  captureBeforeMs: number;
  source: "payment-observer";
  status: "pending" | "authorized" | "captured" | "voided" | "failed";
  providerReceiptFingerprint: string;
}
export interface ObservedDeployment extends PublicConstructorInputs {
  id: string;
  quoteId: string;
  quoteVersion: number;
  observationVersion: 2;
  source: "chain-observer";
  network: string;
  nonce: string;
  address: string;
  phase: "DEPLOYED";
  revision: 0;
  termsCommitment: string;
  artifactFingerprint: string;
  keySetFingerprint: string;
  rolesFingerprint: string;
  initialStateFingerprint: string;
  genesisHash: string;
  entrypoints: readonly string[];
  maintenancePolicy: "locked";
  maintenanceReceiptFingerprint: string;
  blockHash: string;
  blockHeight: number;
  stateFingerprint: string;
  observedAt: number;
  acceptanceDeadlineSeconds: number;
  deliveryDeadlineSeconds: number;
  reviewDeadlineSeconds: number;
  resolutionDeadlineSeconds: number;
}
export interface AdmissionBinding {
  network: string;
  nonce: string;
  address: string;
  quoteId: string;
  observationId: string;
  authorizationId: string;
  boundAt: number;
}
export interface AdmissionTransaction {
  authenticatedAccountId(): string | undefined;
  serverNow(): number;
  getFrozenQuote(id: string): FrozenQuote | undefined;
  getCurrentPaymentAuthorization(id: string): PaymentAuthorization | undefined;
  getObservedDeployment(id: string): ObservedDeployment | undefined;
  getAdmissionTimingPolicy(network: string): AdmissionTimingPolicy | undefined;
  getBinding(network: string, nonce: string): AdmissionBinding | undefined;
  getBindingByAddress(address: string): AdmissionBinding | undefined;
  getBindingByQuote(quoteId: string): AdmissionBinding | undefined;
  insertBinding(binding: AdmissionBinding): void;
}
export function paymentBindsQuote(
  payment: {
    quoteId: string;
    quoteVersion: number;
    buyerAccountId: string;
    amountMinor: number;
    currency: string;
  },
  quote: {
    id: string;
    version: number;
    buyerAccountId: string;
    amountMinor: number;
    currency: string;
  },
): boolean {
  return (
    payment.quoteId === quote.id &&
    payment.quoteVersion === quote.version &&
    payment.buyerAccountId === quote.buyerAccountId &&
    payment.amountMinor === quote.amountMinor &&
    payment.currency === quote.currency
  );
}
export interface AdmissionTimingPolicy {
  captureSafetyMarginMs: number;
}
export interface AtomicAdmissionRepository {
  transact<T>(operation: (tx: AdmissionTransaction) => T): T;
}
export interface BindAdmissionInput {
  quoteId: string;
  observationId: string;
  authorizationId: string;
  address: string;
}
export type AdmissionDecision =
  | { kind: "bound"; binding: AdmissionBinding }
  | { kind: "already-bound"; binding: AdmissionBinding }
  | { kind: "rejected"; reason: string };

export const MAX_OBSERVATION_AGE_MS = 5 * 60_000;
export const PAYMENT_AUTHORIZATION_WINDOW_MS = 60_000;
export const MAX_FUTURE_SKEW_MS = 30_000;

const INPUT_KEYS = [
  "address",
  "authorizationId",
  "observationId",
  "quoteId",
] as const;
const REQUIRED_SET: ReadonlySet<string> = new Set(REQUIRED_ENTRYPOINTS);
const QUOTE_HASHES = [
  "termsCommitment",
  "artifactFingerprint",
  "keySetFingerprint",
  "rolesFingerprint",
  "initialStateFingerprint",
  "genesisHash",
] as const;
const OBSERVED_HASHES = [
  ...QUOTE_HASHES,
  "maintenanceReceiptFingerprint",
  "blockHash",
  "stateFingerprint",
] as const;
const POLICY_FIELDS = [
  "termsCommitment",
  "constructorVersion",
  "constructorEncoding",
  "buyerCommitment",
  "merchantCommitment",
  "operatorCommitment",
  "artifactFingerprint",
  "keySetFingerprint",
  "rolesFingerprint",
  "initialStateFingerprint",
  "genesisHash",
  "acceptanceDeadlineSeconds",
  "deliveryDeadlineSeconds",
  "reviewDeadlineSeconds",
  "resolutionDeadlineSeconds",
] as const;

const isId = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;
const hash = (value: string): boolean => HEX64.test(value);
const rejected = (reason: string): AdmissionDecision => ({
  kind: "rejected",
  reason,
});
const positive = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;
const hashes = (value: object, fields: readonly string[]): boolean =>
  fields.every((field) => hash((value as Record<string, string>)[field]));

export function decideCanonicalAdmission(
  repository: AtomicAdmissionRepository,
  input: BindAdmissionInput,
): AdmissionDecision {
  assertExactInput(input);
  return repository.transact((tx) => {
    const accountId = tx.authenticatedAccountId();
    const now = tx.serverNow();
    const quote = tx.getFrozenQuote(input.quoteId);
    const authorization = tx.getCurrentPaymentAuthorization(
      input.authorizationId,
    );
    const observation = tx.getObservedDeployment(input.observationId);
    if (!quote) return rejected("frozen quote is missing");
    const timingPolicy = tx.getAdmissionTimingPolicy(quote.network);
    if (!authorization)
      return rejected("independent payment authorization is missing");
    if (!observation)
      return rejected("trusted deployment observation is missing");
    const invalid = validate(
      accountId,
      now,
      input,
      quote,
      authorization,
      observation,
      timingPolicy,
    );
    if (invalid) return rejected(invalid);
    const nonceBinding = tx.getBinding(quote.network, quote.nonce);
    const addressBinding = tx.getBindingByAddress(input.address);
    const quoteBinding = tx.getBindingByQuote(quote.id);
    const bindings = [nonceBinding, addressBinding, quoteBinding].filter(
      (binding): binding is AdmissionBinding => binding !== undefined,
    );
    if (bindings.length)
      return bindings.every((binding) => sameBinding(binding, quote, input))
        ? { kind: "already-bound", binding: bindings[0] }
        : rejected("canonical quote, nonce, or address is already bound");
    const binding = {
      network: quote.network,
      nonce: quote.nonce,
      address: input.address,
      quoteId: quote.id,
      observationId: observation.id,
      authorizationId: authorization.id,
      boundAt: now,
    };
    tx.insertBinding(binding);
    return { kind: "bound", binding };
  });
}

function validate(
  accountId: string | undefined,
  now: number,
  input: BindAdmissionInput,
  quote: FrozenQuote,
  authorization: PaymentAuthorization,
  observed: ObservedDeployment,
  timingPolicy: AdmissionTimingPolicy | undefined,
): string | undefined {
  if (!isId(accountId)) return "authenticated buyer is required";
  if (!Number.isSafeInteger(now) || now < 0) return "server clock is invalid";
  if (!HEX64.test(input.address)) return "contract address is malformed";
  if (!validQuote(quote)) return "frozen quote is invalid";
  if (quote.id !== input.quoteId)
    return "frozen quote identity does not match requested quote";
  if (accountId !== quote.buyerAccountId)
    return "authenticated account is not the quote buyer";
  if (
    !validAuthorization(authorization) ||
    authorization.id !== input.authorizationId ||
    !paymentBindsQuote(authorization, quote)
  )
    return "payment authorization is not bound to the exact frozen quote";
  if (now < authorization.usableFrom || now >= authorization.usableUntil)
    return "independent payment authorization window is not active";
  if (!validTimingPolicy(timingPolicy))
    return "server admission timing policy is invalid";
  if (BigInt(now) >= BigInt(quote.acceptanceDeadlineSeconds) * 1000n)
    return "acceptance deadline has expired";
  if (
    BigInt(quote.resolutionDeadlineSeconds) * 1000n +
      BigInt(timingPolicy.captureSafetyMarginMs) >=
    BigInt(authorization.captureBeforeMs)
  )
    return "payment authorization expires before the required resolution window";
  if (
    !validObserved(observed) ||
    observed.id !== input.observationId ||
    observed.network !== quote.network ||
    observed.nonce !== quote.nonce ||
    observed.address !== input.address
  )
    return "observed deployment identity does not match frozen quote";
  if (
    now - observed.observedAt > MAX_OBSERVATION_AGE_MS ||
    observed.observedAt - now > MAX_FUTURE_SKEW_MS
  )
    return "deployment observation is not fresh";
  if (!POLICY_FIELDS.every((field) => observed[field] === quote[field]))
    return "observed deployment does not match approved quote policy";
  if (!isBootstrapComplete(observed))
    return "observed deployment bootstrap policy is incomplete";
  return undefined;
}

function validQuote(q: FrozenQuote): boolean {
  return (
    validPublicConstructor(q) &&
    isId(q.id) &&
    isId(q.network) &&
    isId(q.nonce) &&
    isId(q.buyerAccountId) &&
    positive(q.version) &&
    positive(q.amountMinor) &&
    validDeadlines(q) &&
    q.currency === "USD" &&
    hashes(q, QUOTE_HASHES)
  );
}

function validAuthorization(a: PaymentAuthorization): boolean {
  return (
    a.source === "payment-observer" &&
    a.status === "authorized" &&
    isId(a.id) &&
    isId(a.quoteId) &&
    isId(a.buyerAccountId) &&
    positive(a.quoteVersion) &&
    positive(a.amountMinor) &&
    a.currency === "USD" &&
    Number.isSafeInteger(a.usableFrom) &&
    Number.isSafeInteger(a.usableUntil) &&
    a.usableFrom >= 0 &&
    a.usableUntil >= 0 &&
    a.usableFrom < a.usableUntil &&
    positive(a.captureBeforeMs) &&
    a.usableUntil <= a.captureBeforeMs &&
    hash(a.providerReceiptFingerprint)
  );
}

function validObserved(o: ObservedDeployment): boolean {
  return (
    o.source === "chain-observer" &&
    o.observationVersion === 2 &&
    isId(o.id) &&
    isId(o.quoteId) &&
    positive(o.quoteVersion) &&
    isId(o.network) &&
    isId(o.nonce) &&
    HEX64.test(o.address) &&
    Number.isSafeInteger(o.observedAt) &&
    o.observedAt >= 0 &&
    Number.isSafeInteger(o.blockHeight) &&
    o.blockHeight >= 0 &&
    validDeadlines(o) &&
    hashes(o, OBSERVED_HASHES)
  );
}

function validDeadlines(value: {
  acceptanceDeadlineSeconds: number;
  deliveryDeadlineSeconds: number;
  reviewDeadlineSeconds: number;
  resolutionDeadlineSeconds: number;
}): boolean {
  const deadlines = [
    value.acceptanceDeadlineSeconds,
    value.deliveryDeadlineSeconds,
    value.reviewDeadlineSeconds,
    value.resolutionDeadlineSeconds,
  ];
  return (
    deadlines.every(positive) &&
    deadlines.every(
      (deadline, index) => index === 0 || deadlines[index - 1] < deadline,
    )
  );
}
function validTimingPolicy(policy: unknown): policy is AdmissionTimingPolicy {
  if (typeof policy !== "object" || policy === null) return false;
  const margin = (policy as { captureSafetyMarginMs?: unknown })
    .captureSafetyMarginMs;
  return (
    typeof margin === "number" && Number.isSafeInteger(margin) && margin > 0
  );
}

function sameEntrypoints(actual: readonly string[]): boolean {
  return (
    actual.length === REQUIRED_ENTRYPOINTS.length &&
    new Set(actual).size === actual.length &&
    actual.every((entrypoint) => REQUIRED_SET.has(entrypoint))
  );
}

function isBootstrapComplete(o: ObservedDeployment): boolean {
  return (
    sameEntrypoints(o.entrypoints) &&
    o.phase === "DEPLOYED" &&
    o.revision === 0 &&
    o.maintenancePolicy === "locked"
  );
}

export function validDeploymentObservation(o: ObservedDeployment): boolean {
  return (
    validObserved(o) &&
    isId(o.quoteId) &&
    positive(o.quoteVersion) &&
    isBootstrapComplete(o)
  );
}

export type ObservationBinding =
  | { kind: "bind"; phase: string; revision: number }
  | { kind: "stale"; reason: string }
  | { kind: "contradictory"; reason: string }
  | { kind: "address-claimed"; reason: string };
export interface ChainOrderTruth {
  orderId: string;
  address: string;
  nonce: string;
  artifactFingerprint: string;
  phase: string;
  revision: number;
}
export interface ChainObservationInput {
  orderId: string;
  address: string;
  nonce: string;
  artifactFingerprint: string;
  phase: string;
  revision: number;
}
const MISMATCH = "observation does not match the admitted order";
export function decideObservationBinding(
  current: ChainOrderTruth | null | undefined,
  observed: ChainObservationInput,
  addressOwner?: { orderId: string } | null,
): ObservationBinding {
  if (!current) return { kind: "contradictory", reason: MISMATCH };
  if (
    addressOwner &&
    addressOwner.orderId !== current.orderId &&
    addressOwner.orderId !== observed.orderId
  )
    return {
      kind: "address-claimed",
      reason: "the observed address is already bound to a different order",
    };
  if (
    current.orderId !== observed.orderId ||
    current.address !== observed.address ||
    current.nonce !== observed.nonce
  )
    return { kind: "contradictory", reason: MISMATCH };
  if (current.artifactFingerprint !== observed.artifactFingerprint)
    return {
      kind: "contradictory",
      reason:
        "observation does not reproduce the admitted artifact fingerprint",
    };
  if (observed.revision < current.revision)
    return {
      kind: "stale",
      reason: "chain observation is behind the recorded revision",
    };
  if (
    observed.revision === current.revision &&
    observed.phase !== current.phase
  )
    return { kind: "contradictory", reason: MISMATCH };
  return { kind: "bind", phase: observed.phase, revision: observed.revision };
}

function sameBinding(
  binding: AdmissionBinding,
  quote: FrozenQuote,
  input: BindAdmissionInput,
): boolean {
  return (
    binding.network === quote.network &&
    binding.nonce === quote.nonce &&
    binding.address === input.address &&
    binding.quoteId === quote.id &&
    binding.observationId === input.observationId &&
    binding.authorizationId === input.authorizationId
  );
}

function assertExactInput(input: BindAdmissionInput): void {
  if (
    !input ||
    typeof input !== "object" ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  )
    throw new Error("admission input must be a plain object");
  const keys = Object.keys(input).sort();
  if (
    Object.getOwnPropertySymbols(input).length ||
    keys.length !== INPUT_KEYS.length ||
    keys.some((key, index) => key !== INPUT_KEYS[index]) ||
    !INPUT_KEYS.every((key) => isId(input[key]))
  )
    throw new Error(
      "admission input must contain only non-empty quote, observation, authorization IDs and address",
    );
}
