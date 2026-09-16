import type {
  Payment,
  Phase,
  Role,
} from "../../../../packages/domain/src/prototype";
import { REVIEW_DEADLINE } from "../reviewDeadline";

/**
 * Single source for phase framing (one fact, one carrier — 04 §2.2):
 * heading = the task state; next = who acts; due = absolute deadline;
 * consequence = what inaction does (01 §8.2). Consumed by OrderView,
 * Orders and ActionPanel so the surfaces cannot drift apart. The deadline
 * itself lives in ../reviewDeadline (boundary-clean; 01 §7.4).
 */

export type PhaseFrame = {
  heading: string;
  next: string;
  due: string | null;
  consequence: string;
};

export function phaseFrame(phase: Phase, role: Role): PhaseFrame {
  const you = (actor: Role, yours: string, theirs: string) =>
    role === actor ? yours : theirs;
  switch (phase) {
    case "DRAFT":
      return {
        heading: "Review the quote",
        next: you(
          "buyer",
          "You prepare this device, verify the recovery kit, then authorize the hold",
          "The buyer prepares setup",
        ),
        due: null,
        consequence: "No contract or payment exists yet.",
      };
    case "DEPLOYED":
      return {
        heading: "Reservation unfinished",
        next: you(
          "buyer",
          "You reserve the checked deployment",
          "The buyer reserves the checked deployment",
        ),
        due: REVIEW_DEADLINE,
        consequence: "An unanswered reservation expires.",
      };
    case "RESERVED":
      return {
        heading:
          role === "merchant" ? "Accept or decline" : "Waiting for the studio",
        next: "North Studio accepts or declines",
        due: REVIEW_DEADLINE,
        consequence: "No decision lets the reservation lapse.",
      };
    case "ACCEPTED":
      return {
        heading: "In the studio",
        next: "North Studio delivers the three fixed images",
        due: REVIEW_DEADLINE,
        consequence: "A missed delivery opens the dispute path.",
      };
    case "SUBMITTED":
      return {
        heading: "Delivery ready for review",
        next: you(
          "buyer",
          "You review the delivery",
          "The buyer reviews the delivery",
        ),
        due: REVIEW_DEADLINE,
        consequence:
          "An unanswered review opens a dispute — never auto-approval.",
      };
    case "DISPUTED":
      return {
        heading: "A clear resolution is needed",
        next: "The pre-agreed operator resolves in full — approval or cancellation",
        due: REVIEW_DEADLINE,
        consequence: "An unresolved dispute expires to cancellation.",
      };
    case "APPROVED":
      return {
        heading: "Delivery approved",
        next: "Payment reconciles separately from the approval",
        due: null,
        consequence: "Approval alone is not a paid invoice.",
      };
    case "CANCELLED":
      return {
        heading: "Order closed",
        next: "Any payment hold still reconciles separately",
        due: null,
        consequence: "Cancellation is final.",
      };
  }
}

/** Payment as a human clause, kept separate from order state (04 §7.2/§11). */
export function paymentLine(payment: Payment): string {
  switch (payment) {
    case "authorized":
      return "hold authorized; not captured";
    case "captured":
      return "captured separately from approval";
    case "expired":
      return "hold expired; payment unresolved";
    case "failed":
      return "payment failed; approval unchanged";
    case "voided":
      return "hold released";
    case "none":
      return "no payment attempt yet";
  }
}
