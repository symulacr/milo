import { useEffect, useRef } from "react";
import { EXPIRY_GRACE_MS } from "../../../../packages/backend/src/order-windows";
import type { OrderDetail, Role, Stage } from "../api";
import type { OrderCircuitName } from "../chain";
import type { AppIcon } from "../components/icons";
import {
  BadgeAlertIcon,
  BanIcon,
  CheckIcon,
  CircleCheckIcon,
  GavelIcon,
  LockIcon,
  TimerIcon,
  UndoIcon,
  UploadIcon,
  XIcon,
} from "../components/icons";

import { ROLE_NAME, tickClock, useClock } from "../lib/format";

export const STAGE_LABEL: Record<Stage, string> = {
  QUOTE: "Quote",
  PAYMENT_HELD: "Payment held",
  DEPLOYED: "Contract live",
  RESERVED: "Reserved",
  ACCEPTED: "Accepted",
  SUBMITTED: "Delivered",
  DISPUTED: "Disputed",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

export const TRACK = [
  "QUOTE",
  "PAYMENT_HELD",
  "DEPLOYED",
  "RESERVED",
  "ACCEPTED",
  "SUBMITTED",
  "APPROVED",
] as const satisfies readonly Stage[];

export const PAYMENT_LABEL: Record<OrderDetail["payment"]["state"], string> = {
  none: "No payment",
  pending: "Authorized",
  held: "Authorized",
  captured: "Captured",
  released: "Voided",
  failed: "Failed",
  "needs-card": "Card needed",
};

/** Phase-bar caption: payment as words, not a chip. */
export const PAYMENT_CAPTION: Record<OrderDetail["payment"]["state"], string> =
  {
    none: "No card on this order yet.",
    pending: "Card authorized. Capture waits for approval.",
    held: "Card authorized. Capture waits for approval.",
    captured: "Card captured.",
    released: "Authorization voided.",
    failed: "Card payment failed.",
    "needs-card": "A card is still needed to continue.",
  };

export const trackIndex = (stage: Stage) =>
  TRACK.indexOf(
    (stage === "DISPUTED" ? "SUBMITTED" : stage) as (typeof TRACK)[number],
  );

export type Deadlines = NonNullable<OrderDetail["deadlines"]>;

export type OrderAction = {
  readonly circuit: OrderCircuitName | "start";
  readonly icon: AppIcon;
  readonly label: string;
  readonly weight: "primary" | "danger";
  readonly needs?: "note" | "files" | "delivery";
  readonly approveOrder?: boolean;
  readonly expiry?: boolean;
};

type Spec = readonly [
  OrderCircuitName | "start",
  AppIcon,
  string,
  danger?: boolean,
  approveOrder?: boolean,
];

type Row = readonly [
  who: Role | null,
  doing: string,
  deadline: readonly [keyof Deadlines, string] | null,
  plan: Partial<Record<Role, readonly Spec[]>>,
  expiry?: Spec,
];

const ACCEPTANCE = ["acceptance", "Accept by"] as const;
const DELIVERY = ["delivery", "Deliver by"] as const;
const REVIEW = ["review", "Review by"] as const;
const RESOLUTION = ["resolution", "Resolve by"] as const;

const ROWS: Record<Stage, Row> = {
  QUOTE: [
    "buyer",
    "start the order",
    null,
    { buyer: [["start", LockIcon, "Authorize and reserve"]] },
  ],
  PAYMENT_HELD: [
    "buyer",
    "publish the contract",
    null,
    { buyer: [["start", LockIcon, "Finish authorize and reserve"]] },
  ],
  DEPLOYED: [
    "buyer",
    "reserve the terms",
    ACCEPTANCE,
    { buyer: [["start", LockIcon, "Finish authorize and reserve"]] },
    ["expireBootstrap", TimerIcon, "Expire the order", true],
  ],
  RESERVED: [
    "merchant",
    "accept or decline the order",
    ACCEPTANCE,
    {
      buyer: [["cancelReserved", UndoIcon, "Cancel the reservation", true]],
      merchant: [
        ["accept", CheckIcon, "Accept the order"],
        ["decline", XIcon, "Decline the order", true],
      ],
    },
    ["expireReserved", TimerIcon, "Expire the order", true],
  ],
  ACCEPTED: [
    "merchant",
    "deliver three images",
    DELIVERY,
    {
      buyer: [["disputeBuyer", BadgeAlertIcon, "Open a dispute", true]],
      merchant: [
        ["submitDelivery", UploadIcon, "Deliver three files"],
        ["disputeMerchant", BadgeAlertIcon, "Open a dispute", true],
      ],
    },
    ["expireUndelivered", TimerIcon, "Expire the order", true],
  ],
  SUBMITTED: [
    "buyer",
    "review the delivery",
    REVIEW,
    {
      buyer: [
        ["approve", CircleCheckIcon, "Approve and capture"],
        ["disputeBuyer", BadgeAlertIcon, "Open a dispute", true],
      ],
    },
    ["escalateUnreviewed", BadgeAlertIcon, "Escalate to the operator", true],
  ],
  DISPUTED: [
    "operator",
    "resolve the dispute, or expire it if no evidence was recorded",
    RESOLUTION,
    {
      operator: [
        ["resolve", GavelIcon, "Approve the delivery", false, true],
        ["resolve", BanIcon, "Cancel the order", true, false],
      ],
    },
    ["expireDispute", TimerIcon, "Expire the dispute", true],
  ],
  APPROVED: [null, "", null, {}],
  CANCELLED: [null, "", null, {}],
};

const NEEDS: Partial<Record<string, OrderAction["needs"]>> = {
  submitDelivery: "files",
  approve: "delivery",
  disputeBuyer: "note",
  disputeMerchant: "note",
};

const act = ([
  circuit,
  icon,
  label,
  danger,
  approveOrder,
]: Spec): OrderAction => ({
  circuit,
  icon,
  label,
  weight: danger ? "danger" : "primary",
  needs: NEEDS[circuit],
  approveOrder,
});

export function deadlineOf(stage: Stage, deadlines: Deadlines | null) {
  const entry = ROWS[stage][2];
  if (!entry || !deadlines) return null;
  return { label: entry[1], at: Number(deadlines[entry[0]]) * 1000 };
}

export function actionsFor(
  stage: Stage,
  role: Role,
  deadlines: Deadlines | null,
  now: number,
): readonly OrderAction[] {
  const [, , deadline, plan, expiry] = ROWS[stage];
  if (
    expiry &&
    deadline &&
    now >= Number(deadlines?.[deadline[0]]) * 1000 + EXPIRY_GRACE_MS
  )
    return [{ ...act(expiry), expiry: true }];
  return (plan[role] ?? []).map(act);
}

export const yourTurn = (role: Role, stage: Stage) => ROWS[stage][0] === role;

export type Turn = { title: string; body: string; mine: boolean };

const ENDED: Partial<Record<Stage, string>> = {
  APPROVED: "The client approved the delivery.",
  CANCELLED: "The order ended without approval.",
};

export function turnOf(
  stage: Stage,
  role: Role,
  inviteClaimed: boolean,
  expired: boolean,
): Turn {
  const [who, doing] = ROWS[stage];
  const ended = ENDED[stage];
  if (!who && ended)
    return { title: STAGE_LABEL[stage], body: ended, mine: false };
  if (expired)
    return {
      title: "The window has closed",
      body: "No one acted in time. Any account can now expire the order.",
      mine: true,
    };
  if (who === role)
    return {
      title: "Your turn",
      body: `${doing[0].toUpperCase()}${doing.slice(1)}.`,
      mine: true,
    };
  const other = who ? ROLE_NAME[who].toLowerCase() : "studio";
  return {
    title: `Waiting for the ${other}`,
    body:
      stage === "QUOTE" && inviteClaimed
        ? "The client opened the order."
        : `The ${other} will ${doing}.`,
    mine: false,
  };
}

/**
 * The clock the deadline decisions are made against.
 *
 * G-04: `actionsFor` compares `now` with server-issued deadlines, and `now` came
 * straight from `Date.now()`. A device 10 minutes fast was offered the expiry
 * action while the server still accepted the normal one; 10 minutes slow and the
 * window looked open after it had closed. The chain enforces the real deadline,
 * so this was never a way to act illegally — it was the wrong button offered.
 *
 * `serverNow` is the server's own millisecond clock, carried on the order
 * payload. When it is present the offset is applied to the local clock, so the
 * countdown and the action list agree with the server without polling: the
 * offset is captured once per payload and the local ticker keeps running, which
 * is what makes this cost no extra request. When it is absent (an older
 * deployment) the local clock is used unchanged, so this degrades to today's
 * behaviour instead of breaking.
 */
export function useNow(intervalMs = 30_000, serverNow?: number | null) {
  // A ref, not state: the offset must not cost a render, and re-capturing it on
  // every tick would make the countdown jitter with the network.
  const skew = useRef(0);
  if (serverNow != null) skew.current = serverNow - Date.now();
  const local = useClock();
  useEffect(() => {
    const timer = setInterval(tickClock, intervalMs);
    // Browsers throttle timers in a hidden tab, so without this a returning
    // tab shows a stale countdown until the next tick.
    document.addEventListener("visibilitychange", tickClock);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tickClock);
    };
  }, [intervalMs]);
  return local + skew.current;
}
