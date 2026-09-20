/** A deterministic, synthetic fixture for UI prototyping; it has no persistence or chain authority. */
export type Role = "buyer" | "merchant" | "operator";
export type Phase =
  | "DRAFT"
  | "DEPLOYED"
  | "RESERVED"
  | "ACCEPTED"
  | "SUBMITTED"
  | "DISPUTED"
  | "APPROVED"
  | "CANCELLED";
export type Payment = "none" | "authorized" | "captured" | "voided" | "expired";
export type Scenario =
  | "fresh"
  | "review"
  | "dispute"
  | "expired"
  | "pending"
  | "lost-capability";

/** Single source for the synthetic action vocabulary, in stable order. */
export const ACTION_NAMES = [
  "ready",
  "verify-recovery",
  "authorize",
  "deploy",
  "reserve",
  "accept",
  "submit",
  "verify",
  "approve",
  "dispute",
  "resolve-approve",
  "resolve-cancel",
  "cancel",
  "decline",
  "advance-deadline",
  "capture",
  "void",
  "expire-hold",
  "reconcile",
  "restore",
  "lose-capability",
  "mark-unknown",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export type Action = ActionName;
export interface ActionPayload {
  verifiedFileIds?: string[];
}

export interface SimEvent {
  id: string;
  label: string;
  detail: string;
}

export interface SimState {
  phase: Phase;
  payment: Payment;
  role: Role;
  ready: boolean;
  filesVerified: boolean;
  outcomeUnknown: boolean;
  capabilityAvailable: boolean;
  /** Set by the immutable delivery submission; full-approval resolution
   * requires it, mirroring order.compact resolve. */
  deliverySubmitted: boolean;
  /** Verified recovery kit — a distinct consent moment before the payment
   * hold (05 §4.2/§4.3), reset on role change like device readiness. */
  recoveryVerified: boolean;
  revision: number;
  events: SimEvent[];
}

export const SYNTHETIC_ORDER_FIXTURE = {
  quote: { amountMinor: 36_000, currency: "USD", merchant: "North Studio" },
  files: [
    { id: "01", name: "01-still-hero.png" },
    { id: "02", name: "02-still-detail.png" },
    { id: "03", name: "03-still-collection.png" },
  ],
} as const;

const FILE_IDS = SYNTHETIC_ORDER_FIXTURE.files.map((file) => file.id);

const scenarios: Record<Scenario, Omit<SimState, "events">> = {
  fresh: {
    phase: "DRAFT",
    payment: "none",
    role: "buyer",
    ready: false,
    filesVerified: false,
    outcomeUnknown: false,
    capabilityAvailable: true,
    deliverySubmitted: false,
    recoveryVerified: false,
    revision: 0,
  },
  review: {
    phase: "SUBMITTED",
    payment: "authorized",
    role: "buyer",
    ready: true,
    filesVerified: false,
    outcomeUnknown: false,
    capabilityAvailable: true,
    deliverySubmitted: true,
    recoveryVerified: true,
    revision: 0,
  },
  dispute: {
    phase: "DISPUTED",
    payment: "authorized",
    role: "operator",
    ready: true,
    filesVerified: false,
    outcomeUnknown: false,
    capabilityAvailable: true,
    deliverySubmitted: true,
    recoveryVerified: true,
    revision: 0,
  },
  expired: {
    phase: "SUBMITTED",
    payment: "expired",
    role: "buyer",
    ready: true,
    filesVerified: false,
    outcomeUnknown: false,
    capabilityAvailable: true,
    deliverySubmitted: true,
    recoveryVerified: true,
    revision: 0,
  },
  pending: {
    phase: "APPROVED",
    payment: "authorized",
    role: "operator",
    ready: true,
    filesVerified: true,
    outcomeUnknown: true,
    capabilityAvailable: true,
    deliverySubmitted: true,
    recoveryVerified: true,
    revision: 0,
  },
  "lost-capability": {
    phase: "DEPLOYED",
    payment: "authorized",
    role: "buyer",
    ready: true,
    filesVerified: false,
    deliverySubmitted: false,
    recoveryVerified: true,
    outcomeUnknown: false,
    capabilityAvailable: false,
    revision: 0,
  },
};

export function createScenario(scenario: Scenario): SimState {
  const state = scenarios[scenario];
  return {
    ...state,
    events: [
      {
        id: "event-0",
        label: "Synthetic scenario",
        detail: `${scenario} fixture; no real order, payment, or chain effect.`,
      },
    ],
  };
}

export function actionDescription(action: Action): string {
  const name = action;
  return {
    ready: "Confirm simulated prerequisites",
    "verify-recovery": "Verify recovery kit",
    authorize: "Authorize synthetic payment hold",
    deploy: "Deploy synthetic order",
    reserve: "Reserve order",
    accept: "Accept order",
    submit: "Submit three-image delivery",
    verify: "Verify supplied file receipts",
    approve: "Approve delivery",
    dispute: "Open dispute",
    "resolve-approve": "Resolve dispute for approval",
    "resolve-cancel": "Resolve dispute by cancellation",
    cancel: "Cancel reserved order",
    decline: "Decline reserved order",
    "advance-deadline": "Advance synthetic deadline",
    capture: "Reconcile capture",
    void: "Reconcile void",
    "expire-hold": "Mark hold expired",
    reconcile: "Reconcile unknown outcome",
    restore: "Restore synthetic capability",
    "lose-capability": "Lose synthetic capability",
    "mark-unknown": "Mark outcome unknown",
  }[name];
}

export function changeRole(state: SimState, role: Role): SimState {
  if (!isRole(role))
    throw new Error("Cannot change role: unsupported synthetic role");
  if (state.role === role) return copy(state);
  return apply(
    state,
    "Role changed",
    `Synthetic role switch to ${role}; it does not authenticate a real actor.`,
    { role, ready: false, filesVerified: false, recoveryVerified: false },
  );
}

export function invalidateFileVerification(state: SimState): SimState {
  if (!state.filesVerified) return copy(state);
  return apply(
    state,
    "Sample byte check invalidated",
    "A new check must finish before approval.",
    { filesVerified: false },
  );
}

export function availableActions(state: SimState): Action[] {
  const candidates: Action[] = [...ACTION_NAMES];
  return candidates.filter((action) => {
    try {
      transition(
        state,
        action,
        action === "verify" ? { verifiedFileIds: [...FILE_IDS] } : undefined,
      );
      return true;
    } catch {
      return false;
    }
  });
}

export function transition(
  state: SimState,
  action: Action,
  payload?: ActionPayload,
): SimState {
  const name = action;
  const require = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`Cannot ${name}: ${message}`);
  };
  const buyer = () => require(state.role === "buyer", "buyer role required");
  const merchant = () =>
    require(state.role === "merchant", "merchant role required");
  const operator = () =>
    require(state.role === "operator", "operator role required");
  const phase = (value: Phase) =>
    require(state.phase === value, `${value} phase required`);
  const authorized = () =>
    require(state.payment === "authorized", "authorized payment hold required");
  const capable = () =>
    require(state.capabilityAvailable, "synthetic capability unavailable");
  const known = () =>
    require(!state.outcomeUnknown, "outcome must be reconciled first");
  const actionable = () => {
    capable();
    known();
  };

  switch (name) {
    case "ready":
      buyer();
      require(state.phase === "DRAFT" ||
        state.phase === "DEPLOYED", "DRAFT or DEPLOYED phase required");
      require(!state.ready, "simulated prerequisites already ready");
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic prerequisites marked ready.",
        { ready: true },
      );
    case "verify-recovery":
      buyer();
      phase("DRAFT");
      actionable();
      require(state.ready, "device preparation required first");
      require(!state.recoveryVerified, "recovery kit already verified");
      return apply(
        state,
        actionDescription(action),
        "Synthetic recovery kit verified locally; no bytes leave this browser.",
        { recoveryVerified: true },
      );
    case "authorize":
      buyer();
      phase("DRAFT");
      require(state.ready, "simulated prerequisites not ready");
      require(state.recoveryVerified, "verified recovery kit required before the hold");
      require(state.payment ===
        "none", "payment hold already has a terminal or authorized state");
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic payment hold authorized; no provider was contacted.",
        { payment: "authorized" },
      );
    case "deploy":
      buyer();
      phase("DRAFT");
      require(state.ready, "simulated prerequisites not ready");
      authorized();
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic order moved to DEPLOYED; no chain transaction was sent. A real bootstrap is staged and multi-transaction today.",
        { phase: "DEPLOYED" },
      );
    case "reserve":
      buyer();
      phase("DEPLOYED");
      require(state.ready, "simulated prerequisites not ready");
      authorized();
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic order reserved.",
        { phase: "RESERVED" },
      );
    case "accept":
      merchant();
      phase("RESERVED");
      authorized();
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic merchant acceptance recorded.",
        { phase: "ACCEPTED" },
      );
    case "submit":
      merchant();
      phase("ACCEPTED");
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic immutable delivery submission recorded.",
        { phase: "SUBMITTED", deliverySubmitted: true },
      );
    case "verify":
      buyer();
      phase("SUBMITTED");
      actionable();
      require(!state.filesVerified, "file receipts already verified");
      require(sameFileIds(
        payload,
      ), "all three synthetic file receipt IDs (01, 02, 03) are required");
      return apply(
        state,
        actionDescription(action),
        "Sample file receipt IDs recorded. The UI separately compares downloaded SHA-256 digests; no chain commitment is verified.",
        { filesVerified: true },
      );
    case "approve":
      buyer();
      phase("SUBMITTED");
      authorized();
      actionable();
      require(state.filesVerified, "verified file receipts required");
      return apply(
        state,
        actionDescription(action),
        "Synthetic approval recorded; payment remains separately authorized.",
        { phase: "APPROVED" },
      );
    case "dispute":
      // 01 §4.2: buyer in SUBMITTED; either party in ACCEPTED.
      require((state.role === "buyer" &&
        (state.phase === "SUBMITTED" || state.phase === "ACCEPTED")) ||
        (state.role === "merchant" &&
          state.phase ===
            "ACCEPTED"), "dispute requires buyer in SUBMITTED or either party in ACCEPTED");
      actionable();
      return apply(
        state,
        actionDescription(action),
        `Synthetic ${state.role} dispute opened.`,
        { phase: "DISPUTED" },
      );
    case "resolve-approve":
      operator();
      phase("DISPUTED");
      actionable();
      require(state.deliverySubmitted, "a submitted delivery is required for full approval");
      return apply(
        state,
        actionDescription(action),
        "Synthetic operator resolved for full approval; payment remains separate.",
        { phase: "APPROVED" },
      );
    case "resolve-cancel":
      operator();
      phase("DISPUTED");
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic operator resolved for full cancellation; payment remains separate.",
        { phase: "CANCELLED" },
      );
    case "cancel":
      buyer();
      phase("RESERVED");
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic reserved order cancelled.",
        { phase: "CANCELLED" },
      );
    case "decline":
      merchant();
      phase("RESERVED");
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic merchant decline recorded as cancellation.",
        { phase: "CANCELLED" },
      );
    case "advance-deadline":
      known();
      return advanceDeadline(state);
    case "capture":
      operator();
      phase("APPROVED");
      authorized();
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic capture reconciliation recorded; no payment was captured.",
        { payment: "captured" },
      );
    case "void":
      operator();
      phase("CANCELLED");
      authorized();
      actionable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic void reconciliation recorded; no payment was voided.",
        { payment: "voided" },
      );
    case "expire-hold":
      authorized();
      known();
      return apply(
        state,
        actionDescription(action),
        "Synthetic hold expiry recorded; order phase is unchanged.",
        { payment: "expired" },
      );
    case "reconcile":
      require(state.outcomeUnknown, "outcome is already known");
      return apply(
        state,
        actionDescription(action),
        "Synthetic observation reconciled; no external effect was repeated.",
        { outcomeUnknown: false },
      );
    case "restore":
      require(!state.capabilityAvailable, "synthetic capability is already available");
      return apply(
        state,
        actionDescription(action),
        "Synthetic capability restored only in this fixture.",
        { capabilityAvailable: true },
      );
    case "lose-capability":
      capable();
      return apply(
        state,
        actionDescription(action),
        "Synthetic capability marked unavailable.",
        { capabilityAvailable: false },
      );
    case "mark-unknown":
      known();
      return apply(
        state,
        actionDescription(action),
        "Synthetic external outcome marked unknown.",
        { outcomeUnknown: true },
      );
  }
}

function sameFileIds(payload?: ActionPayload): boolean {
  const ids = payload?.verifiedFileIds;
  return (
    Array.isArray(ids) &&
    ids.length === FILE_IDS.length &&
    new Set(ids).size === FILE_IDS.length &&
    FILE_IDS.every((id) => ids.includes(id))
  );
}

function advanceDeadline(state: SimState): SimState {
  const transitions: Partial<Record<Phase, Partial<SimState>>> = {
    DEPLOYED: { phase: "CANCELLED" },
    RESERVED: { phase: "CANCELLED" },
    ACCEPTED: { phase: "CANCELLED" },
    SUBMITTED: { phase: "DISPUTED" },
    DISPUTED: { phase: "CANCELLED" },
  };
  const nextPhase = transitions[state.phase];
  if (!nextPhase)
    throw new Error(
      `Cannot advance-deadline: no pending deadline in ${state.phase}`,
    );
  return apply(
    state,
    actionDescription("advance-deadline"),
    "Deadline reached; awaiting the applicable action. Synthetic advance only — no clock, network action, or automatic external effect occurred.",
    nextPhase,
  );
}

function apply(
  state: SimState,
  label: string,
  detail: string,
  changes: Partial<SimState>,
): SimState {
  const revision = state.revision + 1;
  return {
    ...state,
    ...changes,
    revision,
    events: [...state.events, { id: `event-${revision}`, label, detail }],
  };
}

function copy(state: SimState): SimState {
  return { ...state, events: state.events.map((event) => ({ ...event })) };
}

function isRole(role: unknown): role is Role {
  return role === "buyer" || role === "merchant" || role === "operator";
}
