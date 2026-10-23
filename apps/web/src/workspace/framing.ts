import type {
  Payment,
  Phase,
  Role,
} from "../../../../packages/domain/src/prototype";
import { REVIEW_DEADLINE } from "../reviewDeadline";

type PhaseFrame = {
  heading: string;
  next: string;
  due: string | null;
  consequence: string;
};

type FrameCopy = {
  heading: string | ((role: Role) => string);
  next: string | ((role: Role) => string);
  consequence: string;
};

const buyerOr = (role: Role, yours: string, theirs: string): string =>
  role === "buyer" ? yours : theirs;

const FRAMES: Record<Phase, FrameCopy> = {
  DRAFT: {
    heading: "Review the quote",
    next: (role) =>
      buyerOr(
        role,
        "You prepare this device, verify the recovery kit, then authorize the hold",
        "The buyer prepares setup",
      ),
    consequence: "No contract or payment exists yet.",
  },
  DEPLOYED: {
    heading: "Reservation unfinished",
    next: (role) =>
      buyerOr(
        role,
        "You reserve the checked deployment",
        "The buyer reserves the checked deployment",
      ),
    consequence: "An unanswered reservation expires.",
  },
  RESERVED: {
    heading: (role) =>
      role === "merchant" ? "Accept or decline" : "Waiting for the studio",
    next: "North Studio accepts or declines",
    consequence: "No decision lets the reservation lapse.",
  },
  ACCEPTED: {
    heading: "In the studio",
    next: "North Studio delivers the three fixed images",
    consequence: "A missed delivery opens the dispute path.",
  },
  SUBMITTED: {
    heading: "Delivery ready for review",
    next: (role) =>
      buyerOr(
        role,
        "You review the delivery",
        "The buyer reviews the delivery",
      ),
    consequence: "An unanswered review opens a dispute — never auto-approval.",
  },
  DISPUTED: {
    heading: "A clear resolution is needed",
    next: "The pre-agreed operator resolves in full — approval or cancellation",
    consequence: "An unresolved dispute expires to cancellation.",
  },
  APPROVED: {
    heading: "Delivery approved",
    next: "Payment reconciles separately from the approval",
    consequence: "Approval alone is not a paid invoice.",
  },
  CANCELLED: {
    heading: "Order closed",
    next: "Any payment hold still reconciles separately",
    consequence: "Cancellation is final.",
  },
};

const DEADLINED: ReadonlySet<Phase> = new Set<Phase>([
  "DEPLOYED",
  "RESERVED",
  "ACCEPTED",
  "SUBMITTED",
  "DISPUTED",
]);

const resolve = (
  field: string | ((role: Role) => string),
  role: Role,
): string => (typeof field === "function" ? field(role) : field);

export function phaseFrame(phase: Phase, role: Role): PhaseFrame {
  const frame = FRAMES[phase];
  return {
    heading: resolve(frame.heading, role),
    next: resolve(frame.next, role),
    due: DEADLINED.has(phase) ? REVIEW_DEADLINE : null,
    consequence: frame.consequence,
  };
}

export const paymentBadge: Record<Payment, string> = {
  none: "No payment attempt",
  authorized: "Hold authorized",
  captured: "Captured",
  voided: "Hold released",
  expired: "Hold expired",
  failed: "Payment failed",
};

const PAYMENT_LINES: Record<Payment, string> = {
  authorized: "hold authorized; not captured",
  captured: "captured separately from approval",
  expired: "hold expired; payment unresolved",
  voided: "hold released",
  none: "no payment attempt yet",
  failed: "attempt failed; payment unresolved",
};

export function paymentLine(payment: Payment): string {
  return PAYMENT_LINES[payment];
}
