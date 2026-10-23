import { z } from "zod";

export type PaymentOperation = "authorize" | "capture" | "void";
export type PaymentStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "voided"
  | "failed"
  | "unknown";
export interface PaymentAttempt {
  operationId: string;
  operation: PaymentOperation;
  orderId: string;
  version: number;
  idempotencyKey: string;
  status: PaymentStatus;
  latestProviderTime?: number;
}
export interface PaymentEvent {
  providerEventId: string;
  operationId: string;
  operation: PaymentOperation;
  orderId: string;
  version: number;
  idempotencyKey: string;
  occurredAt: number;
  status: Exclude<PaymentStatus, "pending" | "unknown">;
}
export interface InboxEvent {
  event: PaymentEvent;
  matched: boolean;
}
export interface ReconciliationState {
  attempts: Readonly<Record<string, PaymentAttempt>>;
  operationKeys: Readonly<Record<string, string>>;
  orderVersionKeys: Readonly<Record<string, string>>;
  inbox: Readonly<Record<string, InboxEvent>>;
}
export type InboxResult =
  | "accepted"
  | "duplicate"
  | "out-of-order"
  | "unmatched";
export interface AttemptIdentity {
  operationId: string;
  operation: PaymentOperation;
  orderId: string;
  version: number;
  idempotencyKey: string;
}

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((v: string) => v.trim().length > 0);
const identitySchema = z.strictObject({
  operationId: id,
  operation: z.enum(["authorize", "capture", "void"]),
  orderId: id,
  version: z.number().int().nonnegative(),
  idempotencyKey: id,
});
const eventSchema = identitySchema.extend({
  providerEventId: id,
  occurredAt: z.number().int().nonnegative(),
  status: z.enum(["authorized", "captured", "voided", "failed"]),
});
const TERMINAL: ReadonlySet<PaymentStatus> = new Set([
  "captured",
  "voided",
  "failed",
]);

export const emptyReconciliationState = (): ReconciliationState => ({
  attempts: Object.create(null),
  operationKeys: Object.create(null),
  orderVersionKeys: Object.create(null),
  inbox: Object.create(null),
});

export function createAttempt(
  state: ReconciliationState,
  identity: AttemptIdentity,
): ReconciliationState {
  identity = identitySchema.parse(identity);
  const knownKey = get(state.operationKeys, identity.operationId);
  if (knownKey && knownKey !== identity.idempotencyKey)
    throw new Error(
      "logical operation is already bound to its original idempotency key",
    );
  const orderVersionKey = orderVersion(identity);
  const knownOrderKey = get(state.orderVersionKeys, orderVersionKey);
  if (knownOrderKey && knownOrderKey !== identity.idempotencyKey)
    throw new Error(
      "order version is already bound to its original idempotency key",
    );
  const existing = get(state.attempts, identity.idempotencyKey);
  if (existing) {
    if (!sameIdentity(existing, identity))
      throw new Error("idempotency key is already bound to another operation");
    return state;
  }
  const next = {
    ...state,
    attempts: put(state.attempts, identity.idempotencyKey, {
      ...identity,
      status: "pending",
    }),
    operationKeys: put(
      state.operationKeys,
      identity.operationId,
      identity.idempotencyKey,
    ),
    orderVersionKeys: put(
      state.orderVersionKeys,
      orderVersionKey,
      identity.idempotencyKey,
    ),
  };
  return reconcileInbox(next, identity);
}
export function markOutcomeUnknown(
  state: ReconciliationState,
  idempotencyKey: string,
): ReconciliationState {
  const attempt = requiredAttempt(state, idempotencyKey);
  return attempt.status === "pending"
    ? replaceAttempt(state, { ...attempt, status: "unknown" })
    : state;
}
export function receivePaymentEvent(
  state: ReconciliationState,
  event: PaymentEvent,
): { state: ReconciliationState; result: InboxResult } {
  event = eventSchema.parse(event);
  const prior = get(state.inbox, event.providerEventId);
  if (prior) {
    if (!sameEvent(prior.event, event))
      throw new Error("provider event ID payload mismatch");
    return { state, result: "duplicate" };
  }
  const staged = {
    ...state,
    inbox: put(state.inbox, event.providerEventId, { event, matched: false }),
  };
  const attempt = get(staged.attempts, event.idempotencyKey);
  return !attempt || !sameIdentity(attempt, event)
    ? { state: staged, result: "unmatched" }
    : apply(staged, attempt, event);
}
export function reconciliationKey(
  state: ReconciliationState,
  idempotencyKey: string,
): string {
  const attempt = requiredAttempt(state, idempotencyKey);
  if (attempt.status !== "unknown")
    throw new Error("only an unknown payment outcome needs reconciliation");
  return attempt.idempotencyKey;
}

function reconcileInbox(
  state: ReconciliationState,
  identity: AttemptIdentity,
): ReconciliationState {
  let next = state;
  for (const [, inbox] of Object.entries(state.inbox))
    if (!inbox.matched && sameIdentity(identity, inbox.event))
      next = apply(
        next,
        requiredAttempt(next, identity.idempotencyKey),
        inbox.event,
      ).state;
  return next;
}
function stale(
  attempt: PaymentAttempt,
  event: PaymentEvent,
  latest: number | undefined,
): boolean {
  return (
    (latest !== undefined && event.occurredAt < latest) ||
    (latest === event.occurredAt && attempt.status !== event.status) ||
    (TERMINAL.has(attempt.status) && attempt.status !== event.status)
  );
}
function apply(
  state: ReconciliationState,
  attempt: PaymentAttempt,
  event: PaymentEvent,
): { state: ReconciliationState; result: InboxResult } {
  if (stale(attempt, event, attempt.latestProviderTime))
    return { state, result: "out-of-order" };
  const updated = replaceAttempt(state, {
    ...attempt,
    status: event.status,
    latestProviderTime: Math.max(
      attempt.latestProviderTime ?? event.occurredAt,
      event.occurredAt,
    ),
  });
  return {
    state: {
      ...updated,
      inbox: put(updated.inbox, event.providerEventId, {
        event,
        matched: true,
      }),
    },
    result: "accepted",
  };
}
function replaceAttempt(
  state: ReconciliationState,
  attempt: PaymentAttempt,
): ReconciliationState {
  return {
    ...state,
    attempts: put(state.attempts, attempt.idempotencyKey, attempt),
  };
}
function requiredAttempt(
  state: ReconciliationState,
  key: string,
): PaymentAttempt {
  if (!id.safeParse(key).success)
    throw new Error("idempotency key is required");
  const attempt = get(state.attempts, key);
  if (!attempt) throw new Error("payment attempt is missing");
  return attempt;
}
function sameIdentity(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return (
    a.operationId === b.operationId &&
    a.operation === b.operation &&
    a.orderId === b.orderId &&
    a.version === b.version &&
    a.idempotencyKey === b.idempotencyKey
  );
}
function sameEvent(a: PaymentEvent, b: PaymentEvent): boolean {
  return (
    a.providerEventId === b.providerEventId &&
    sameIdentity(a, b) &&
    a.occurredAt === b.occurredAt &&
    a.status === b.status
  );
}
function get<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
function put<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T,
): Record<string, T> {
  return Object.assign(Object.create(null), record, { [key]: value });
}
function orderVersion(identity: AttemptIdentity): string {
  return JSON.stringify([
    identity.orderId,
    identity.operation,
    identity.version,
  ]);
}
