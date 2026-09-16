import {
  type PublicConstructorInputs,
  validPublicConstructor,
} from "./public-constructor.mjs";

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
  /** Independently retrieved provider authorization expiry, in milliseconds. */
  captureBeforeMs: number;
  source: "payment-observer";
  status: "pending" | "authorized" | "captured" | "voided" | "failed";
  providerReceiptFingerprint: string;
}
export interface ObservedDeployment extends PublicConstructorInputs {
  id: string;
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
  /** Returns current independently observed provider state, never a caller claim. */
  getCurrentPaymentAuthorization(id: string): PaymentAuthorization | undefined;
  getObservedDeployment(id: string): ObservedDeployment | undefined;
  getAdmissionTimingPolicy(network: string): AdmissionTimingPolicy | undefined;
  getBinding(network: string, nonce: string): AdmissionBinding | undefined;
  getBindingByAddress(address: string): AdmissionBinding | undefined;
  getBindingByQuote(quoteId: string): AdmissionBinding | undefined;
  insertBinding(binding: AdmissionBinding): void;
}
/** Server-owned capture safety policy; callers cannot supply it in admission input. */
export interface AdmissionTimingPolicy {
  captureSafetyMarginMs: number;
}
/** Production must implement this as one database transaction; tests may use an explicit double. */
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

const ADDRESS = /^[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_OBSERVATION_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;

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
  if (!ADDRESS.test(input.address)) return "contract address is malformed";
  if (!validQuote(quote)) return "frozen quote is invalid";
  if (quote.id !== input.quoteId)
    return "frozen quote identity does not match requested quote";
  if (accountId !== quote.buyerAccountId)
    return "authenticated account is not the quote buyer";
  if (
    !validAuthorization(authorization) ||
    authorization.id !== input.authorizationId ||
    authorization.quoteId !== quote.id ||
    authorization.quoteVersion !== quote.version ||
    authorization.buyerAccountId !== accountId ||
    authorization.amountMinor !== quote.amountMinor ||
    authorization.currency !== quote.currency
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
  if (
    observed.termsCommitment !== quote.termsCommitment ||
    observed.constructorVersion !== quote.constructorVersion ||
    observed.constructorEncoding !== quote.constructorEncoding ||
    observed.buyerCommitment !== quote.buyerCommitment ||
    observed.merchantCommitment !== quote.merchantCommitment ||
    observed.operatorCommitment !== quote.operatorCommitment ||
    observed.artifactFingerprint !== quote.artifactFingerprint ||
    observed.keySetFingerprint !== quote.keySetFingerprint ||
    observed.rolesFingerprint !== quote.rolesFingerprint ||
    observed.initialStateFingerprint !== quote.initialStateFingerprint ||
    observed.genesisHash !== quote.genesisHash ||
    observed.acceptanceDeadlineSeconds !== quote.acceptanceDeadlineSeconds ||
    observed.deliveryDeadlineSeconds !== quote.deliveryDeadlineSeconds ||
    observed.reviewDeadlineSeconds !== quote.reviewDeadlineSeconds ||
    observed.resolutionDeadlineSeconds !== quote.resolutionDeadlineSeconds
  )
    return "observed deployment does not match approved quote policy";
  if (
    !sameEntrypoints(observed.entrypoints) ||
    observed.phase !== "DEPLOYED" ||
    observed.revision !== 0 ||
    observed.maintenancePolicy !== "locked"
  )
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
    Number.isSafeInteger(q.version) &&
    q.version > 0 &&
    Number.isSafeInteger(q.amountMinor) &&
    q.amountMinor > 0 &&
    validDeadlines(q) &&
    q.currency === "USD" &&
    [
      q.termsCommitment,
      q.artifactFingerprint,
      q.keySetFingerprint,
      q.rolesFingerprint,
      q.initialStateFingerprint,
      q.genesisHash,
    ].every(hash)
  );
}
function validAuthorization(a: PaymentAuthorization): boolean {
  return (
    a.source === "payment-observer" &&
    a.status === "authorized" &&
    isId(a.id) &&
    isId(a.quoteId) &&
    isId(a.buyerAccountId) &&
    Number.isSafeInteger(a.quoteVersion) &&
    a.quoteVersion > 0 &&
    Number.isSafeInteger(a.amountMinor) &&
    a.amountMinor > 0 &&
    a.currency === "USD" &&
    Number.isSafeInteger(a.usableFrom) &&
    Number.isSafeInteger(a.usableUntil) &&
    a.usableFrom >= 0 &&
    a.usableUntil >= 0 &&
    a.usableFrom < a.usableUntil &&
    Number.isSafeInteger(a.captureBeforeMs) &&
    a.captureBeforeMs > 0 &&
    a.usableUntil <= a.captureBeforeMs &&
    hash(a.providerReceiptFingerprint)
  );
}
function validObserved(o: ObservedDeployment): boolean {
  return (
    o.source === "chain-observer" &&
    o.observationVersion === 2 &&
    isId(o.id) &&
    isId(o.network) &&
    isId(o.nonce) &&
    ADDRESS.test(o.address) &&
    Number.isSafeInteger(o.observedAt) &&
    o.observedAt >= 0 &&
    Number.isSafeInteger(o.blockHeight) &&
    o.blockHeight >= 0 &&
    validDeadlines(o) &&
    [
      o.termsCommitment,
      o.artifactFingerprint,
      o.keySetFingerprint,
      o.rolesFingerprint,
      o.initialStateFingerprint,
      o.genesisHash,
      o.maintenanceReceiptFingerprint,
      o.blockHash,
      o.stateFingerprint,
    ].every(hash)
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
    deadlines.every(
      (deadline) => Number.isSafeInteger(deadline) && deadline > 0,
    ) &&
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
    REQUIRED_ENTRYPOINTS.every((entrypoint) => actual.includes(entrypoint))
  );
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
  const allowed = ["address", "authorizationId", "observationId", "quoteId"];
  if (
    Object.getOwnPropertySymbols(input).length ||
    keys.length !== allowed.length ||
    keys.some((key, index) => key !== allowed[index]) ||
    !allowed.every((key) => isId(input[key as keyof BindAdmissionInput]))
  )
    throw new Error(
      "admission input must contain only non-empty quote, observation, authorization IDs and address",
    );
}
function hash(value: string): boolean {
  return HASH.test(value);
}
function isId(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function rejected(reason: string): AdmissionDecision {
  return { kind: "rejected", reason };
}
