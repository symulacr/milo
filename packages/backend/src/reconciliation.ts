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
  .refine((value) => value.trim().length > 0);
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
  const inbox = put(state.inbox, event.providerEventId, {
    event,
    matched: false,
  });
  const staged = { ...state, inbox };
  const attempt = get(staged.attempts, event.idempotencyKey);
  if (!attempt || !matches(attempt, event))
    return { state: staged, result: "unmatched" };
  return apply(staged, attempt, event);
}
/** Reconciliation always returns the original provider idempotency key; it never mints one. */
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
  for (const [, inbox] of Object.entries(state.inbox)) {
    if (!inbox.matched && matches(identity, inbox.event)) {
      const applied = apply(
        next,
        requiredAttempt(next, identity.idempotencyKey),
        inbox.event,
      );
      next = applied.state;
    }
  }
  return next;
}
function apply(
  state: ReconciliationState,
  attempt: PaymentAttempt,
  event: PaymentEvent,
): { state: ReconciliationState; result: InboxResult } {
  if (
    attempt.latestProviderTime !== undefined &&
    event.occurredAt < attempt.latestProviderTime
  )
    return { state, result: "out-of-order" };
  if (
    attempt.latestProviderTime === event.occurredAt &&
    attempt.status !== event.status
  )
    return { state, result: "out-of-order" };
  if (terminal(attempt.status) && attempt.status !== event.status)
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
function terminal(status: PaymentStatus): boolean {
  return status === "captured" || status === "voided" || status === "failed";
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
  requireId(key, "idempotency key");
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
function matches(attempt: AttemptIdentity, event: PaymentEvent): boolean {
  return sameIdentity(attempt, event);
}
function sameEvent(a: PaymentEvent, b: PaymentEvent): boolean {
  return (
    a.providerEventId === b.providerEventId &&
    matches(a, b) &&
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
function requireId(value: string, label: string): void {
  if (!id.safeParse(value).success) throw new Error(`${label} is required`);
}
function orderVersion(identity: AttemptIdentity): string {
  return JSON.stringify([
    identity.orderId,
    identity.operation,
    identity.version,
  ]);
}
